# Leave SSH secrets with OpenSSH

Skills Desktop stores non-secret Target references and delegates SSH credential
handling to existing OpenSSH configuration and agents rather than becoming a
private-key or password vault. It also uses OpenSSH host-identity facilities;
the exact host-key policy remains a separate decision. This reduces the
application's secret-bearing surface and aligns desktop targets with operators'
existing SSH trust configuration.

## Consequences

- Private keys and passwords are not persisted by Skills Desktop.
- Target persistence must distinguish display identity, connection reference,
  and verified host identity without copying secret material.
- Connection and authentication evidence must be structured and redacted before
  it reaches logs or the renderer.
