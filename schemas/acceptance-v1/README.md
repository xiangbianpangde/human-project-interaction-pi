# HPI Acceptance Wire v1 Contracts

This directory contains the frozen JSON Schema 2020-12 external wire contracts for formal TS-001 validation and acceptance:

- `experiment-spec.v1.schema.json`: read-only ExperimentSpec schema (`urn:hpi:wire:experiment-spec:v1`);
- `validation-result.v1.schema.json`: formal ValidationResult schema (`urn:hpi:wire:validation-result:v1`);
- `manifest.v1.json`: schema set metadata and immutable digest `9e623718cb1dc444b22375e3471a43941972f30b2fb7c2b2c96111d4e35c79bb`.

## Lineage and Dependencies

This schema set explicitly pins and depends on:

1. `hpi/wire/v1` (`1d08d1acdda0cf05b29aae46949c900e49349eb21225d75698c6a44c34264725`);
2. `hpi/wire/execution/v2` (`bccb373985dacfdff8eaa1c2f7001cb4644a1d4c931e5359ce4200f69836439c`).

All preceding wire sets remain strictly immutable.
