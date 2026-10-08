#!/usr/bin/env bash
# Circuit matrix chosen for variety: figure-eight, tight street, high-speed, long, classic.
set -euo pipefail
cd "$(dirname "$0")"
python spike.py --year 2024 --circuit Suzuka --known-length-m 5807
python spike.py --year 2024 --circuit Monaco --known-length-m 3337
python spike.py --year 2024 --circuit Monza --known-length-m 5793
python spike.py --year 2024 --circuit Spa-Francorchamps --known-length-m 7004
python spike.py --year 2024 --circuit Silverstone --known-length-m 5891
