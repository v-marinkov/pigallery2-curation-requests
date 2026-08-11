from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ServerInstallScriptTests(unittest.TestCase):
    def test_installs_release_and_configures_existing_pigallery(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-server-install-") as folder:
            root = Path(folder)
            install_root = root / "pigallery2"
            config_path = install_root / "config" / "config.json"
            photo_root = root / "photos"
            fake_bin = root / "bin"
            config_path.parent.mkdir(parents=True)
            photo_root.mkdir()
            fake_bin.mkdir()
            config_path.write_text(
                json.dumps(
                    {
                        "Server": {"applicationTitle": "Family Photos"},
                        "Database": {"type": "sqlite"},
                    }
                ),
                encoding="utf-8",
            )

            fake_docker = fake_bin / "docker"
            fake_docker.write_text(
                textwrap.dedent(
                    """\
                    #!/bin/sh
                    case "$1" in
                      inspect)
                        if [ "${2:-}" != "-f" ]; then
                          exit 0
                        fi
                        case "$3" in
                          *State.Running*) printf '%s\n' true ;;
                          *Config.Image*) printf '%s\n' example/pigallery2:test ;;
                          *'/app/data/curation'*) printf '%s\n' true ;;
                          *'/app/data/images'*) printf '%s\n' false ;;
                          *'/app/dist/en/pg2-curation-script.js'*) printf '%s\n' false ;;
                          *) exit 1 ;;
                        esac
                        ;;
                      compose|stop|start|exec|run)
                        exit 0
                        ;;
                      *)
                        exit 1
                        ;;
                    esac
                    """
                ),
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)

            env_path = root / "install.env"
            env_path.write_text(
                textwrap.dedent(
                    f"""\
                    PG2_INSTALL_ROOT={install_root}
                    PG2_CONTAINER=pigallery2
                    PG2_COMPOSE_DIR={install_root}
                    PG2_COMPOSE_SERVICE=pigallery2
                    PG2_EXTENSION_DIR={install_root}/config/extensions/curation-requests
                    PG2_CLI_DIR={install_root}/curation/cli
                    PG2_CUSTOM_ASSETS_DIR={install_root}/custom_assets
                    PG2_CONFIG_FILE={config_path}
                    PG2_CONTAINER_EXTENSION_DIR=/app/data/config/extensions/curation-requests
                    PG2_CONTAINER_CURATION_DIR=/app/data/curation
                    PG2_CONTAINER_IMAGE_DIR=/app/data/images
                    PG2_CONTAINER_ASSET_PATH=/app/dist/en/pg2-curation-script.js
                    PG2_EXTENSION_FOLDER=curation-requests
                    PG2_EXTENSION_DATABASE_PATH=/app/data/curation/curation.sqlite
                    PG2_EXTENSION_REQUESTER_ALLOWLIST=admin, family-user
                    PG2_EXTENSION_COMMENT_MAX_LENGTH=2500
                    PG2_CURATION_DB={install_root}/curation/curation.sqlite
                    PG2_PHOTO_ROOT={photo_root}
                    PG2_SIDECAR_STYLE=appended
                    PG2_INSTALL_GIT_PULL=false
                    PG2_INSTALL_DEPENDENCIES=false
                    PG2_RECREATE_CONTAINER=true
                    """
                ),
                encoding="utf-8",
            )

            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
            environment["PG2_INSTALL_ENV_FILE"] = str(env_path)
            completed = subprocess.run(
                [str(PROJECT_ROOT / "install.sh")],
                cwd=PROJECT_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertIn("Installation complete.", completed.stdout)

            extension_dir = install_root / "config" / "extensions" / "curation-requests"
            self.assertTrue((extension_dir / "server.js").is_file())
            self.assertTrue((extension_dir / "src" / "db" / "repository.js").is_file())
            self.assertFalse((extension_dir / "server.ts").exists())
            self.assertFalse((extension_dir / "tests").exists())
            self.assertTrue((install_root / "custom_assets" / "pg2-curation-script.js").is_file())

            cli_env = (install_root / "curation" / "cli" / ".env").read_text(encoding="utf-8")
            self.assertEqual(
                cli_env,
                "\n".join(
                    [
                        f"PG2_CURATION_DB={install_root}/curation/curation.sqlite",
                        f"PG2_PHOTO_ROOT={photo_root}",
                        "PG2_SIDECAR_STYLE=appended",
                        "",
                    ]
                ),
            )

            updated = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(updated["Server"]["applicationTitle"], "Family Photos")
            self.assertEqual(updated["Database"], {"type": "sqlite"})
            self.assertIn("pg2-curation-script.js?v=", updated["Server"]["customHTMLHead"])
            self.assertTrue(Path(f"{config_path}.pg2-curation.bak").is_file())
            self.assertEqual(
                updated["Extensions"]["extensions"]["curation-requests"],
                {
                    "enabled": True,
                    "path": "curation-requests",
                    "configs": {
                        "databasePath": "/app/data/curation/curation.sqlite",
                        "reasonMaxLength": 2500,
                        "requesterAllowlist": "admin, family-user",
                    },
                },
            )

            cli_env_path = install_root / "curation" / "cli" / ".env"
            cli_env_path.write_text("PRESERVE_ME=true\n", encoding="utf-8")
            repeated = subprocess.run(
                [str(PROJECT_ROOT / "install.sh")],
                cwd=PROJECT_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
            self.assertIn("Preserving existing CLI settings", repeated.stdout)
            self.assertEqual(cli_env_path.read_text(encoding="utf-8"), "PRESERVE_ME=true\n")

    def test_check_config_rejects_unsafe_paths_without_calling_docker(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pg2-server-install-") as folder:
            root = Path(folder)
            env_path = root / "install.env"
            env_path.write_text(
                textwrap.dedent(
                    """\
                    PG2_INSTALL_ROOT=/opt/pigallery2
                    PG2_CONTAINER=pigallery2
                    PG2_CURATION_DB=/opt/pigallery2/curation/curation.sqlite
                    PG2_PHOTO_ROOT=/srv/photos/../private
                    """
                ),
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment["PG2_INSTALL_ENV_FILE"] = str(env_path)
            completed = subprocess.run(
                [str(PROJECT_ROOT / "install.sh"), "--check-config"],
                cwd=PROJECT_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("Unsafe absolute installation path", completed.stderr)


if __name__ == "__main__":
    unittest.main()
