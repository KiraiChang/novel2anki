#!/usr/bin/env python3
"""
建立 POS tagger venv 並安裝依賴。

用法：
  python scripts/pos/setup.py
"""

import subprocess
import sys
from pathlib import Path


def main() -> None:
    script_dir = Path(__file__).parent
    venv_dir   = script_dir / '.venv'
    req_file   = script_dir / 'requirements.txt'

    if venv_dir.exists():
        print(f"[setup] venv 已存在：{venv_dir}，跳過建立直接更新套件")
    else:
        print(f"[setup] 建立 venv：{venv_dir}")
        subprocess.run([sys.executable, '-m', 'venv', str(venv_dir)], check=True)
        print("[setup] venv 建立完成")

    pip = (
        venv_dir / 'Scripts' / 'pip.exe'
        if sys.platform == 'win32'
        else venv_dir / 'bin' / 'pip'
    )
    python = (
        venv_dir / 'Scripts' / 'python.exe'
        if sys.platform == 'win32'
        else venv_dir / 'bin' / 'python'
    )

    print(f"[setup] 安裝依賴（{req_file.name}）...")
    subprocess.run([str(pip), 'install', '-r', str(req_file)], check=True)

    print("[setup] 下載 spaCy 英文模型（en_core_web_sm）...")
    subprocess.run([str(python), '-m', 'spacy', 'download', 'en_core_web_sm'], check=True)

    print(f"\n[setup] 完成！POS tagger 使用的 Python：{python}")


if __name__ == '__main__':
    main()
