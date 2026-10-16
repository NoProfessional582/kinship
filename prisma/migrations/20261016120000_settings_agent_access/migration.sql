-- What MCP agents may do: 'write' (default) or 'read'. Additive; 0.4.0 ignores it.
ALTER TABLE "Settings" ADD COLUMN "agentAccess" TEXT NOT NULL DEFAULT 'write';
