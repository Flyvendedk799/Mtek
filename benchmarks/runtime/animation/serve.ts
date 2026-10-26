import {startStaticServer} from "../../../tests/browser/support/serve.ts";
import {site} from "./prepare.ts";
const server=await startStaticServer(site,5185);
console.log(`Production characters: ${server.url}/demo.html`);
process.on("SIGINT",()=>{void server.close();});
