import { MongoClient } from 'mongodb';

export const mongo = new MongoClient(process.env.MONGO_URL!);

await mongo.connect();
