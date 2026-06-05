# Input & Replay Management — Mermaid Diagram

## 1.  Input Flow (Player → Server → Simulation)

```mermaid
flowchart TD
    %% ========== INPUT GENERATION ==========
    subgraph InputGen ["Input Generation (Main Thread)"]
        K["Keypress: turn / break"]
        IM["InputManager"]
        IU["_upsert(tick, apply)"]
        K --> IM
        IM -->|"turn: tick + spread<br/>break: current tick"| IU
    end

    %% ========== CLIENT WORKER INGESTION ==========
    subgraph ClientIngestion ["Client Worker Ingestion"]
        W_LOC["Worker: player_input<br/>source = local"]
        CLI["clientAddLocalInput(input)"]
        LOC_BUF["localInputBuffer<br/>(consume once, never replayed)"]
        W_LOC --> CLI
        CLI -->|record| LOC_BUF
    end

    %% ========== NETWORK TRANSMISSION ==========
    subgraph Transmission ["Network Transmission"]
        IU -->|"postMessage"| W_LOC
        IU -->|"client_turn (sliding window)"| NET["geckos.io (UDP)"]
    end

    %% ========== SERVER INGESTION ==========
    subgraph ServerIngestion ["Server Ingestion"]
        NET --> SNS["ServerNetworkSystem<br/>_onClientTurn"]
        SNS --> SADD["serverAddInput(input)"]
        SADD -->|"if input.tick < room.tick<br/>drop stale"| DROP_STALE["ignored"]
        SADD -->|"record(tick, playerId, input)"| SPB["playerInputBuffer<br/>(TickRingBuffer)"]
        SADD -->|"PingInTicks[eid] =<br/>max(0, tick - input.tick)"| PING["ping tracking"]
    end

    %% ========== AUTHORITATIVE INPUTS BACK TO CLIENT ==========
    subgraph AuthInputs ["Authoritative Inputs (client worker)"]
        W_AUTH["Worker: player_input<br/>source = server"]
        CSA["serverAddInput(input)"]
        AUTH_BUF["playerInputBuffer<br/>(authoritative, replayed)"]
        W_AUTH --> CSA
        CSA -->|record| AUTH_BUF
    end

    %% ========== AUTHORITATIVE DIFFS ==========
    subgraph Diffs ["Authoritative Diffs (client worker)"]
        W_SYNC["Worker: sync_state"]
        ANP["addNetworkDiffPayload(diff)"]
        NDIFF["networkDiffTickRingBuffer"]
        PRT["pendingResimTick"]
        W_SYNC --> ANP
        ANP -->|record| NDIFF
        ANP -->|"pendingResimTick =<br/>min(existing, diff.tick - 1)"| PRT
    end

    %% ========== TICK LOOP ==========
    subgraph TickLoop ["Client Tick Loop (processNextTick)"]
        CHK_RESIM{"pendingResimTick != null<br/>&& tick > pending?"}
        RF["replayFrom(pendingResimTick)"]
        CHK_PEND{"clock.pendingTicks() > 0?"}
        LD["load diff for this.tick<br/>soaDeserialize + observerDeserializeNetwork"]
        UP["update()"]
        TSS["_tryTakeSnapshot(tick)"]
        CT["clock.consumeTicks(1)"]
        IDLE["idle (return false)"]

        CHK_RESIM -->|YES| RF
        CHK_RESIM -->|NO| CHK_PEND
        CHK_PEND -->|YES| LD
        CHK_PEND -->|NO| IDLE
        LD --> UP
        UP --> TSS
        TSS --> CT
    end

    %% ========== REPLAY DETAIL ==========
    subgraph ReplayDetail ["replayFrom(targetTick)"]
        FBA["_findBestAnchor(targetTick)<br/>scan _snapshotRing"]
        RW["resetWorld(world)"]
        SD["snapshotDeserialize<br/>(anchor.buffer)"]
        SET["tick = anchor.tick<br/>replaying = true"]
        LOOP["for _tick = anchor.tick to currentTick"]
        LD2["load diff for _tick"]
        UP2["update()"]
        TI["tick += 1"]
        SET2["replaying = false"]
        ERR["error: cannot resimulate"]

        FBA -->|anchor found| RW
        RW --> SD
        SD --> SET
        SET --> LOOP
        LOOP --> LD2
        LD2 --> UP2
        UP2 --> TI
        TI --> LOOP
        LOOP -->|done| SET2
        FBA -->|no anchor| ERR
    end

    %% ========== UPDATE DETAIL ==========
    subgraph UpdateDetail ["update() — one tick"]
        IG["input getter(entityId)"]
        PRED{"predictLocalInputs<br/>&& !replaying?"}
        CONS["localInputBuffer.consume<br/>(tick, entityId)"]
        GET["playerInputBuffer.get<br/>(tick, entityId)"]
        EV["events getter:<br/>gameEventBuffer.get(tick)"]
        SYS["for each system:<br/>sys.update(input, events)"]
        TICK["tick += 1"]
        ONT["onTick?(tick)"]
        DEC["dirtyEntities.clear()"]

        IG --> PRED
        PRED -->|YES| CONS
        PRED -->|NO| GET
        CONS -->|fallback| GET
        GET --> EV
        EV --> SYS
        SYS --> TICK
        TICK --> ONT
        ONT --> DEC
    end

    %% ========== OUTPUT ==========
    subgraph Output ["Render Output"]
        CAP["captureRenderState()<br/>queued in pendingOutputs"]
        FL["flushOutput()"]
        RSM["render_states message<br/>→ Main Thread"]
        CAP --> FL
        FL --> RSM
    end

    %% ========== CROSS-LINKS ==========
    RF --> ReplayDetail
    UP --> UpdateDetail
    UP2 --> UpdateDetail
    TSS --> SNAP["_snapshotRing<br/>throttle by snapshotPeriodX"]
    UpdateDetail --> CAP
    SNAP -.->|"server: snapshotGapTicks=0<br/>no-op"| SNAP_NOTE["Server does not snapshot"]
```

## 2.  Key Semantics

| Concept | Implementation |
|---|---|
| **Tick points to "next to process"** | It is safe to queue inputs and events for `room.tick` because they are consumed during the `tick → tick+1` transition inside `update()`. |
| **Two input buffers** | `localInputBuffer` holds client-predicted inputs; consumed once with `consume()` and **never** replayed. `playerInputBuffer` holds authoritative server inputs; read with `get()` and **is** replayed during rollback. |
| **Sliding window retransmission** | `InputManager` sends the full buffered window of inputs every frame so UDP packet loss is healed automatically by the next datagram. |
| **Diff → Replay chain** | When a `sync_state` arrives, `addNetworkDiffPayload` schedules a resimulation at `diff.tick - 1`. The next `processNextTick` triggers `replayFrom`, rewinding to the nearest snapshot and replaying forward with stored diffs and inputs. |
| **Snapshot ring** | `_snapshotRing` stores periodic full-world snapshots. During replay the best anchor (most recent snapshot ≤ target tick) is chosen, bounding replay distance. |
| **Same-tick events** | `gameEventBuffer` stores events per tick; all systems in that tick's iteration see the same event list. Events are non-consuming (read but not removed). |
