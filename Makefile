.DEFAULT_GOAL := help
UV ?= uv

.PHONY: help sync lint fmt typecheck test cov check demo clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

sync: ## Create the workspace venv and install every package in editable mode
	$(UV) sync --all-packages

lint: ## Run ruff lint + format checks
	$(UV) run ruff check .
	$(UV) run ruff format --check .

fmt: ## Autoformat and autofix
	$(UV) run ruff format .
	$(UV) run ruff check --fix .

typecheck: ## Run mypy in strict mode
	$(UV) run mypy packages

test: ## Run the test suite (no network)
	$(UV) run pytest -m "not network"

cov: ## Run tests with coverage
	$(UV) run pytest -m "not network" \
		--cov=recite --cov-report=term-missing --cov-report=xml

check: lint typecheck test ## Everything CI runs

demo: ## Lint the bundled example brief
	$(UV) run recite check examples/brief.txt || true
	$(UV) run recite fix examples/brief.txt --diff

clean: ## Remove caches and build artifacts
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov coverage.xml .coverage
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	find . -name '*.egg-info' -type d -prune -exec rm -rf {} +
