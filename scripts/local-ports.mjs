// Probes bind availability without retaining incoming connections from concurrent readiness checks
import { createServer } from 'node:net';

export async function assertAvailablePorts(services) {
  for (const { name, port } of services) {
    const server = createServer(socket => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (cause) {
      if (cause?.code === 'EADDRINUSE') {
        throw new Error(`${name} cannot start: 127.0.0.1:${port} is already in use. Stop the existing server before running pnpm dev again.`);
      }
      throw cause;
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }
}
