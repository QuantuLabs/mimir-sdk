import { Mimir } from "@quantulabs/mimir-sdk";
const mimir = new Mimir();
const price = await mimir.price("COLA");
console.log(price.ticker, price.price, price.quote?.symbol, price.slot, price.updatedAt);
