.PHONY: setup up down check logs migrate seed
setup:
	python3 scripts/setup_local.py
up:
	docker compose up --build --wait
migrate:
	docker compose run --rm migrate
check:
	docker compose run --rm api-test
	docker compose run --rm frontend-test
logs:
	docker compose logs --tail=100
down:
	docker compose down

seed:
	docker compose run --rm seed
