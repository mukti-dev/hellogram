# All production images in one build graph (shared stages are built once):
#   docker buildx bake -f infra/docker/docker-bake.hcl            (local, tags hellogram/*:dev)
# CI sets REGISTRY / TAG and the public VITE_* values, and pushes to GitHub's registry.

variable "REGISTRY" { default = "hellogram" }
variable "TAG" { default = "dev" }
variable "SOURCE_URL" { default = "https://github.com/mukti-dev/hellogram" }

# Public browser settings, baked into the nginx image (not secrets).
variable "VITE_APP_URL" { default = "https://app.hellogram.in" }
variable "VITE_PHONE_AUTH" { default = "otp" }
variable "VITE_FIREBASE_API_KEY" { default = "" }
variable "VITE_FIREBASE_AUTH_DOMAIN" { default = "" }
variable "VITE_FIREBASE_PROJECT_ID" { default = "" }
variable "VITE_FIREBASE_APP_ID" { default = "" }
variable "VITE_TURNSTILE_SITE_KEY" { default = "" }

group "default" {
  targets = ["api", "worker", "admin-api", "migrate", "nginx"]
}

target "_common" {
  context    = "."
  dockerfile = "infra/docker/Dockerfile"
  # Lightsail instances are x86-64.
  platforms = ["linux/amd64"]
  # Links each image to the repository on GitHub (permissions, "Packages" tab).
  labels = { "org.opencontainers.image.source" = SOURCE_URL }
}

target "api" {
  inherits = ["_common"]
  target   = "api"
  tags     = ["${REGISTRY}/api:${TAG}", "${REGISTRY}/api:latest"]
}

target "worker" {
  inherits = ["_common"]
  target   = "worker"
  tags     = ["${REGISTRY}/worker:${TAG}", "${REGISTRY}/worker:latest"]
}

target "admin-api" {
  inherits = ["_common"]
  target   = "admin-api"
  tags     = ["${REGISTRY}/admin-api:${TAG}", "${REGISTRY}/admin-api:latest"]
}

target "migrate" {
  inherits = ["_common"]
  target   = "migrate"
  tags     = ["${REGISTRY}/migrate:${TAG}", "${REGISTRY}/migrate:latest"]
}

target "nginx" {
  inherits = ["_common"]
  target   = "nginx"
  tags     = ["${REGISTRY}/nginx:${TAG}", "${REGISTRY}/nginx:latest"]
  args = {
    VITE_APP_URL              = VITE_APP_URL
    VITE_PHONE_AUTH           = VITE_PHONE_AUTH
    VITE_FIREBASE_API_KEY     = VITE_FIREBASE_API_KEY
    VITE_FIREBASE_AUTH_DOMAIN = VITE_FIREBASE_AUTH_DOMAIN
    VITE_FIREBASE_PROJECT_ID  = VITE_FIREBASE_PROJECT_ID
    VITE_FIREBASE_APP_ID      = VITE_FIREBASE_APP_ID
    VITE_TURNSTILE_SITE_KEY   = VITE_TURNSTILE_SITE_KEY
  }
}
