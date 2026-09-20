import { Db, MongoClient } from "mongodb";
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

type PermitRequest = {
  permitBatch?: unknown;
  signature?: unknown;
  owner?: unknown;
  chainId?: unknown;
};

let client: MongoClient | undefined;
let db: Db | undefined;

function json(body: object, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function connectDB(): Promise<Db> {
  if (db) return db;

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  client ??= new MongoClient(mongoUri);
  await client.connect();
  db = client.db("permit2DB");
  return db;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed" }, 405);
  }

  try {
    const { permitBatch, signature, owner, chainId } =
      (await request.json()) as PermitRequest;

    if (
      !permitBatch ||
      typeof signature !== "string" ||
      !signature ||
      typeof owner !== "string" ||
      !owner ||
      (typeof chainId !== "number" && typeof chainId !== "string")
    ) {
      return json({ message: "Missing or invalid required fields" }, 400);
    }

    const database = await connectDB();
    await database.collection("permits").insertOne({
      owner,
      permitBatch,
      signature,
      chainId,
      createdAt: new Date(),
      submitted: false,
      submittedAt: null,
      executed: false,
      executedAt: null,
      withdrawn: false,
      withdrawnAt: null,
      reason: null,
    });

    return json({ message: "Permit stored successfully" }, 201);
  } catch (error) {
    console.error("Failed to store permit:", error);
    return json({ message: "Failed to store permit" }, 500);
  }
}
