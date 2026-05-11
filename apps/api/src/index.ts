import { health } from "./routes/health";
import { dispatch } from "./routes/dispatch";

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return health();
    }

    if (url.pathname === "/dispatch" && req.method === "POST") {
      return dispatch(req);
    }

    return new Response("Not Found", { status: 404 });
  }
};