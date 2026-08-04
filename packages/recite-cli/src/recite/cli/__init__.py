"""The ``recite`` command line interface."""

__version__ = "0.1.0"

__all__ = ["__version__", "app"]


def __getattr__(name: str) -> object:
    # Imported lazily so that `import recite.cli` stays cheap; loading the app
    # pulls in typer, rich and the whole engine.
    if name == "app":
        from .main import app

        return app
    raise AttributeError(name)
