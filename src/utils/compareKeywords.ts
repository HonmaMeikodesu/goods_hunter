import isValidUrl from "./isValidUrl";

export default function compareKeyword(url1: string, url2: string): boolean {
  if (!isValidUrl(url1) || !isValidUrl(url2)) throw new Error("Invalid Url");
  return (
    new URL(decodeURIComponent(url1)).searchParams.get("keyword") ===
    new URL(decodeURIComponent(url2)).searchParams.get("keyword")
  );
}