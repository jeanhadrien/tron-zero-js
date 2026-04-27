---
name: gcp-deployment
description: Broad guidelines and best practices for deploying containerized applications to Google Cloud Run
license: MIT
compatibility: opencode
---

# Google Cloud Run Deployment Guidelines

This document outlines the high-level requirements and best practices for deploying applications to Google Cloud Run.

## 1. Environment & Containerization

Cloud Run executes applications within Docker containers using minimal Linux base images.
- **Statelessness:** Containers should be stateless. Any persistent data should be stored in managed services (e.g., Cloud SQL, Cloud Storage).
- **System Dependencies:** If the application requires native binaries or system-level libraries (e.g., for graphics, media processing, or native Node extensions), these must be explicitly installed via the system package manager (like `apt-get`) in the `Dockerfile`.

## 2. Dockerfile Best Practices

To optimize cold start times, reduce image size, and ensure security, always use **multi-stage builds**.

### Builder Stage
- Use this stage to install full dependencies, including development tools, headers (`-dev`), and compilers.
- Execute all build, bundling, and compilation steps here.

### Runner Stage (Production)
- Use a minimal base image.
- Install only the required **runtime** system libraries.
- Clean up package manager caches (e.g., `rm -rf /var/lib/apt/lists/*`) to keep the final image small.
- Copy only the compiled application artifacts and production dependencies from the Builder stage.
- **Port Binding:** The application MUST listen on the port defined by the `PORT` environment variable. Cloud Run dynamically assigns this port at runtime.

## 3. Source Deployment Configuration (.gcloudignore)

When deploying directly from source (`gcloud run deploy --source .`), Google Cloud Build uploads the local directory to build the container remotely. A `.gcloudignore` file is critical to ensure fast uploads and prevent conflicts.

**Core files/folders to ignore:**
- Local dependency directories (e.g., `node_modules/`)
- Local build outputs (e.g., `dist/`, `build/`)
- Git history and configuration (`.git/`, `.gitignore`)
- Secrets and local environment files (`.env`, `.env.*`)
- Local logs, IDE folders, and OS metadata (`.vscode/`, `.DS_Store`)

**Explicit inclusions:**
Use the `!` negation operator to guarantee essential source files, configuration files, and dependency lockfiles are uploaded, protecting them from accidental blanket ignore rules (e.g., `!src/`, `!package.json`).

## 4. Standard Deployment Command

```bash
gcloud run deploy <service-name> \
  --source . \
  --platform managed \
  --allow-unauthenticated \
  --port <port-number> \
  --project <project-id>
```