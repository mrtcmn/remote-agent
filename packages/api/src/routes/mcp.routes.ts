import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { mcpService } from '../services/mcp/mcp.service';

export const mcpRoutes = new Elysia({ prefix: '/mcp' })
  .use(requireAuth)

  // GET /mcp/search?q=query&cursor=X - search MCP registry
  .get('/search', async ({ query }) => {
    const q = query.q || '';
    const result = await mcpService.search(q, query.cursor);
    return result;
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      cursor: t.Optional(t.String()),
    }),
  })

  // GET /mcp/servers/:name - get server details from registry
  .get('/servers/:name', async ({ params, set }) => {
    const server = await mcpService.getServer(params.name);
    if (!server) {
      set.status = 404;
      return { error: 'Server not found in registry' };
    }
    return { server };
  }, {
    params: t.Object({
      name: t.String(),
    }),
  })

  // GET /mcp/installed - list installed MCP servers
  .get('/installed', async () => {
    const servers = await mcpService.listInstalled();
    return { servers };
  })

  // POST /mcp/install - install MCP server from registry
  .post('/install', async ({ body, set }) => {
    const { server, configName, envVars, extraArgs } = body;

    if (!server || !configName) {
      set.status = 400;
      return { error: 'server and configName are required' };
    }

    const result = await mcpService.install(server, configName, envVars, extraArgs);
    if (!result.success) {
      set.status = 500;
      return { error: result.error };
    }
    return { success: true };
  }, {
    body: t.Object({
      server: t.Object({
        name: t.String(),
        title: t.Optional(t.String()),
        description: t.String(),
        registryType: t.Optional(t.String()),
        packageId: t.Optional(t.String()),
        version: t.Optional(t.String()),
        repoUrl: t.Optional(t.String()),
        envVars: t.Optional(t.Array(t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          isRequired: t.Optional(t.Boolean()),
          isSecret: t.Optional(t.Boolean()),
          default: t.Optional(t.String()),
          placeholder: t.Optional(t.String()),
        }))),
        args: t.Optional(t.Array(t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          type: t.String(),
          isRequired: t.Optional(t.Boolean()),
          default: t.Optional(t.String()),
          value: t.Optional(t.String()),
          valueHint: t.Optional(t.String()),
        }))),
      }),
      configName: t.String(),
      envVars: t.Optional(t.Record(t.String(), t.String())),
      extraArgs: t.Optional(t.Array(t.String())),
    }),
  })

  // POST /mcp/custom - add a custom MCP server
  .post('/custom', async ({ body, set }) => {
    const { name, command, args, env } = body;

    if (!name || !command) {
      set.status = 400;
      return { error: 'name and command are required' };
    }

    const result = await mcpService.addCustom(name, command, args || [], env);
    if (!result.success) {
      set.status = 500;
      return { error: result.error };
    }
    return { success: true };
  }, {
    body: t.Object({
      name: t.String(),
      command: t.String(),
      args: t.Optional(t.Array(t.String())),
      env: t.Optional(t.Record(t.String(), t.String())),
    }),
  })

  // PUT /mcp/installed/:name - update MCP server config
  .put('/installed/:name', async ({ params, body, set }) => {
    const result = await mcpService.update(params.name, body);
    if (!result.success) {
      set.status = 404;
      return { error: result.error };
    }
    return { success: true };
  }, {
    params: t.Object({
      name: t.String(),
    }),
    body: t.Object({
      command: t.Optional(t.String()),
      args: t.Optional(t.Array(t.String())),
      env: t.Optional(t.Record(t.String(), t.String())),
    }),
  })

  // DELETE /mcp/installed/:name - remove MCP server
  .delete('/installed/:name', async ({ params, set }) => {
    const result = await mcpService.uninstall(params.name);
    if (!result.success) {
      set.status = 404;
      return { error: result.error };
    }
    return { success: true };
  }, {
    params: t.Object({
      name: t.String(),
    }),
  })

  // GET /mcp/config - get raw mcpServers JSON
  .get('/config', async () => {
    const config = await mcpService.getRawConfig();
    return { config };
  })

  // PUT /mcp/config - set raw mcpServers JSON
  .put('/config', async ({ body, set }) => {
    const result = await mcpService.setRawConfig(body.config);
    if (!result.success) {
      set.status = 500;
      return { error: result.error };
    }
    return { success: true };
  }, {
    body: t.Object({
      config: t.Record(t.String(), t.Object({
        command: t.String(),
        args: t.Array(t.String()),
        env: t.Optional(t.Record(t.String(), t.String())),
      })),
    }),
  });
