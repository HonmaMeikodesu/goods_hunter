import * as fs from "fs";
import path from "path";

export const mercariGoodsList = fs.readFileSync(
  path.join(__dirname, "../view/mercari/goodsList.ejs"),
  { encoding: "utf-8" }
);

export const mercariGoodsDetail = fs.readFileSync(
  path.join(__dirname, "../view/mercari/goodDetail.ejs"),
  { encoding: "utf-8" }
);

export const yahooGoodsList = fs.readFileSync(
  path.join(__dirname, "../view/yahoo/goodsList.ejs"),
  { encoding: "utf-8" }
)

export const surugayaGoodsList = fs.readFileSync(
  path.join(__dirname, "../view/surugaya/goodsList.ejs"),
  { encoding: "utf-8" }
);


export const indexPage = fs.readFileSync(
  path.join(__dirname, "../view/index.ejs"),
  { encoding: "utf-8" }
);

