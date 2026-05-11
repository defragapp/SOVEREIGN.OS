export default async function handler(req: any, res: any) {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;

  const response = await fetch(workerUrl + "/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body)
  });

  const json = await response.json();
  res.status(response.status).json(json);
}