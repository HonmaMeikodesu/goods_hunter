import moment from "moment";

export default function isBetweenDayTime(start: string, end: string) {
  const format = "HH:mm";
  const startTime = moment(start, format).date(1);
  const endTime = moment(end, format).date(1);
  const now = moment().format(format);
  const nowTime = moment(now, format).date(1);
  if (endTime.isBefore(startTime)) {
    endTime.date(2);
  }
  return nowTime.isBetween(startTime, endTime);
}
