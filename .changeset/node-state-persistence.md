---
"hardhat": patch
"@nomicfoundation/hardhat-errors": patch
---

Added `--state`, `--load-state` and `--dump-state` to `hardhat node`, which load the local chain's state from a file at startup and save it when the node stops, in the same format as anvil.
