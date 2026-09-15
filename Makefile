.DEFAULT_GOAL := help
.PHONY: help cache tools tools-rebuild dev-web install check lint format typecheck test build-web db-generate check-links ci run shell image up up-docker down restart logs ps serve dev clean

IMAGE ?= junctio:local
TOOLS_IMAGE ?= junctio:tools
COMPOSE ?= docker compose
SERVICE ?= junctio
PORT ?= 3000
WEB_PORT ?= 5173
CMD ?=

ROOT := $(CURDIR)
UID := $(shell id -u)
GID := $(shell id -g)
CACHE := $(ROOT)/.cache
ENV_ARG := $(if $(wildcard $(ROOT)/.env),--env-file $(ROOT)/.env,)

define in_container
docker run --rm $(1) \
	--user $(UID):$(GID) \
	-v $(ROOT):/app \
	-v $(CACHE)/bun:/cache/bun \
	-e BUN_INSTALL_CACHE_DIR=/cache/bun \
	-e HOME=/tmp \
	-w /app \
	$(TOOLS_IMAGE) $(2)
endef

help:
	@printf 'Usage: make <target>\n'
	@printf '\n'
	@printf 'Workspace, each run in a throwaway toolchain container:\n'
	@printf '  install        install dependencies from the lockfile\n'
	@printf '  check          biome check\n'
	@printf '  lint           biome lint\n'
	@printf '  format         biome check --write\n'
	@printf '  typecheck      tsc and vue-tsc across the workspaces\n'
	@printf '  test           bun test\n'
	@printf '  build-web      build the admin ui\n'
	@printf '  db-generate    generate drizzle migrations\n'
	@printf '  check-links    verify the documentation links\n'
	@printf '  ci             check, typecheck, build-web, test\n'
	@printf '  run CMD=...    run any package.json script\n'
	@printf '  shell          open a shell in the toolchain container\n'
	@printf '\n'
	@printf 'Gateway:\n'
	@printf '  serve          run the gateway on PORT=%s\n' '$(PORT)'
	@printf '  dev            run the gateway with a file watcher\n'
	@printf '  dev-web        run the admin ui dev server on WEB_PORT=%s\n' '$(WEB_PORT)'
	@printf '\n'
	@printf 'Image and compose:\n'
	@printf '  image          build %s\n' '$(IMAGE)'
	@printf '  up             start the stack in the background\n'
	@printf '  up-docker      start the stack with the docker socket mounted\n'
	@printf '  down           stop the stack\n'
	@printf '  restart        restart the gateway service\n'
	@printf '  logs           follow the gateway logs\n'
	@printf '  ps             show the stack status\n'
	@printf '\n'
	@printf 'Housekeeping:\n'
	@printf '  tools-rebuild  rebuild the toolchain image\n'
	@printf '  clean          remove node_modules and the bun cache\n'

cache: tools
	@mkdir -p $(CACHE)/bun

tools:
	@docker image inspect $(TOOLS_IMAGE) >/dev/null 2>&1 || docker build --target tools -t $(TOOLS_IMAGE) .

tools-rebuild:
	docker build --no-cache --target tools -t $(TOOLS_IMAGE) .

install: cache
	$(call in_container,-t,bun install --frozen-lockfile)

check: cache
	$(call in_container,-t,bun run check)

lint: cache
	$(call in_container,-t,bun run lint)

format: cache
	$(call in_container,-t,bun run format)

typecheck: cache
	$(call in_container,-t,bun run typecheck)

test: cache
	$(call in_container,-t -e LOG_LEVEL=error,bun test)

build-web: cache
	$(call in_container,-t,bun run build:web)

db-generate: cache
	$(call in_container,-t,bun run db:generate)

check-links: cache
	$(call in_container,-t,bun run check:links)

ci: check typecheck build-web test

run: cache
	@test -n "$(CMD)" || { printf 'set CMD, for example: make run CMD=check\n'; exit 1; }
	$(call in_container,-t,bun run $(CMD))

shell: cache
	$(call in_container,-it $(ENV_ARG),sh)

serve: cache
	$(call in_container,-t -p $(PORT):3000 -e HOST=0.0.0.0 -e PORT=3000 $(ENV_ARG),bun apps/gateway/src/cli/index.ts serve)

dev: cache
	$(call in_container,-t -p $(PORT):3000 -e HOST=0.0.0.0 -e PORT=3000 $(ENV_ARG),bun --watch apps/gateway/src/cli/index.ts serve)

dev-web: cache
	$(call in_container,-t --network host,bun run --cwd apps/web dev --host 0.0.0.0 --port $(WEB_PORT))

image:
	docker build -t $(IMAGE) .

up:
	$(COMPOSE) up -d

up-docker:
	$(COMPOSE) -f compose.yml -f compose.docker.yml up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart $(SERVICE)

logs:
	$(COMPOSE) logs -f $(SERVICE)

ps:
	$(COMPOSE) ps

clean:
	rm -rf $(ROOT)/node_modules $(ROOT)/apps/gateway/node_modules $(ROOT)/apps/web/node_modules $(ROOT)/packages/schema/node_modules $(CACHE)
