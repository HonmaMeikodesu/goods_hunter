import isValidUri from "./isValidUrl";
import errorCode from "../errorCode";
import CONST from "../const";

export default function getHunterType(
  url: string
): typeof CONST.HUNTERTYPE[number] {
  if (!isValidUri(url)) throw new Error(errorCode.getHunterType.invalidUrl);
  const urlObj = new URL(url);
  if (urlObj.host === "api.mercari.jp") {
    return "Mercari";
  }
  throw new Error(errorCode.getHunterType.hunterTypeNotFound);
}
