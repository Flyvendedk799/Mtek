import {defineConfig} from "vitest/config";
export default defineConfig({define:{__MTEK_DEV__:"true"},test:{maxWorkers:1}});
