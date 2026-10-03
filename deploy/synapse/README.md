# Synapse

Self-hosted Matrix homeserver reserved for a later architecture decision. The current Ligo implementation runs through Kerno and PostgreSQL. Synapse is not configured, deployed, or connected to Ligo.

Configuration is reserved for a later scope.

The refactor does not add Matrix adapters or another message store. Ligo/Rondo keep one PostgreSQL membership/history pipeline and share browser chat components. Introducing Synapse would require an explicit identity, encryption and data-ownership decision. See [current architecture](../../docs/architecture.md).
