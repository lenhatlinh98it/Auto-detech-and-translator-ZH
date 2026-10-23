import argparse
import json
import sys
import traceback

from .util import emit


def main():
    parser = argparse.ArgumentParser(prog="vt")
    parser.add_argument("command", choices=["analyze", "render", "preview", "translate", "ocr", "probe", "proxy", "devices"])
    parser.add_argument("--config", required=True, help="Path to a JSON file with the command options")
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    try:
        if args.command == "analyze":
            from . import analyze
            analyze.run(cfg)
        elif args.command == "ocr":
            from . import analyze
            analyze.ocr_region(cfg)
        elif args.command == "render":
            from . import render
            render.run(cfg)
        elif args.command in ("probe", "proxy"):
            from . import render
            getattr(render, args.command)(cfg)
        elif args.command == "devices":
            from . import device
            device.list_devices(cfg)
        elif args.command == "preview":
            from . import render
            render.preview(cfg)
        else:
            from .translate import Translator
            translator = Translator(cfg.get("source", "zh-CN"), cfg.get("target", "vi"), cfg.get("glossary"),
                                    cfg.get("engine", "auto"))
            emit(type="result", texts=translator.translate_many(cfg["texts"]))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit(type="error", message=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
