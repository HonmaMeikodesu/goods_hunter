const MIN = "*/5 * * * * ?"
const MAX = "0 0 0 1 */12 ?"
export default function toCronFormat(time: number) {
  if (time < 300) return MIN;
  if (time > 31536000) return MAX;
  return "";
}