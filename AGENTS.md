## Tech Stack
- **Phaser 3** + **SolidJS** + **TypeScript** + **Vite** (Frontend)
- **Bun** + **Express** + **Socket.io** (Backend)

## Working on this project

You're either working for the client (src/client/*), or the server (src/server/*). Both share common classes (src/shared/*). Limit the scope of your access to the side you are working on. If you are working for the client, do not read files from the server. If you are working for the server, do not read files from the client. If you need cross information, you must ask the user for permission.