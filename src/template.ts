import * as fs from 'fs';
import path from "path";

export const mercariGoodsList = fs.readFileSync(path.join(__dirname, "../view/mercari/goodsList.ejs"), { encoding: "utf-8"});