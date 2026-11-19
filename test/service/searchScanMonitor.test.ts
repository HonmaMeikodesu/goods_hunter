import { SearchScanError } from "../../src/api/site/searchScan";
import { SearchScanMonitor } from "../../src/service/searchScanMonitor";

function monitor() {
  const service = new SearchScanMonitor();
  service.logger = { info: jest.fn(), error: jest.fn() } as any;
  return service;
}

it("records a final outcome per search and preserves the collector result or exception", async () => {
  const service = monitor();
  const insert = jest.fn();
  service.records = { insert } as any;
  const search = jest.fn().mockResolvedValue([]);
  await expect(service.track("Mandarake", search)).resolves.toEqual([]);
  const error = new SearchScanError("UNVERIFIED_RESULTS");
  await expect(service.track("Mercari", async () => { throw error; })).rejects.toBe(error);
  await expect(service.track("Xianyu", async () => {
    throw Object.assign(new Error("Request failed"), {
      isAxiosError: true, response: { status: 403, data: { code: "CHALLENGE_REQUIRED" } },
    });
  })).rejects.toThrow("Request failed");
  expect(insert.mock.calls.map(([row]) => [row.site, row.outcome])).toEqual([
    ["Mandarake", "VALID"], ["Mercari", "UNVERIFIED_RESULTS"], ["Xianyu", "CHALLENGE_REQUIRED"],
  ]);
  insert.mockRejectedValueOnce(new Error("test persistence failure"));
  await expect(service.track("Surugaya", search)).resolves.toEqual([]);
  expect(service.logger.error).toHaveBeenCalled();
});

it("uses Beijing midnight and 22:00, showing reason percentages within anomalies and no-observation sites", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-19T14:00:02Z"));
  try {
    const service = monitor();
    const query = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([
        { site: "Mercari", outcome: "VALID", count: "6" },
        { site: "Mercari", outcome: "CLOUDFLARE_CHALLENGE", count: "3" },
        { site: "Mercari", outcome: "CONNECTION_CLOSED", count: "1" },
        { site: "Surugaya", outcome: "UNVERIFIED_RESULTS", count: "4" },
      ]),
    };
    service.records = { createQueryBuilder: jest.fn().mockReturnValue(query) } as any;
    service.redisClient = { set: jest.fn().mockResolvedValueOnce("OK").mockResolvedValue(null) } as any;
    service.mailInfo = { contactSystemOwner: "ops@example.invalid" } as any;
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    service.emailService = { sendEmail } as any;
    await Promise.all([service.reportToday(), service.reportToday()]);
    expect(query.getRawMany).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith(expect.any(String), {
      start: new Date("2026-11-18T16:00:00Z"), end: new Date("2026-11-19T14:00:00Z"),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "ops@example.invalid", subject: expect.stringContaining("2026-11-19"),
    }));
    const text = sendEmail.mock.calls[0][0].text;
    expect(text).toContain("Mercari｜共 10 次 · 有效 6 次 (60.0%) · 异常 4 次 (40.0%)");
    expect(text).toContain("Cloudflare 验证 3 次 (75.0%)");
    expect(text).toContain("上游连接关闭 1 次 (25.0%)");
    expect(text).toContain("骏河屋｜共 4 次 · 有效 0 次 (0.0%) · 异常 4 次 (100.0%)");
    expect(text).toContain("闲鱼｜无扫描记录");
  } finally {
    jest.useRealTimers();
  }
});
