import { GoodsController } from "../../src/controller/goods";
import { HunterRouteService } from "../../src/service/hunterRouteService";

describe("Yahoo!フリマ task API and routing", () => {
  function controller() {
    const target = new GoodsController();
    target.ctx = { user: { email: "owner@example.invalid" } } as any;
    target.hunterRouteService = { hireNewHunterForUser: jest.fn() } as any;
    target.goodsService = { updateTask: jest.fn(), deleteTask: jest.fn(), listUserTasks: jest.fn().mockResolvedValue([]) } as any;
    return target;
  }

  it("accepts and normalizes the new platform registration", async () => {
    const target = controller();
    await target.registerGoodsWatcher("YahooFleamarket", "*/10 * * * *", undefined, undefined, { keyword: " 缶バッジ ", epoch: 2 });
    expect(target.hunterRouteService.hireNewHunterForUser).toHaveBeenCalledWith(target.ctx, expect.objectContaining({
      type: "YahooFleamarket", searchCondition: expect.objectContaining({ keyword: "缶バッジ", epoch: 2, notifyExisting: false }),
    }));
  });

  it("rejects invalid platform-specific conditions before creating tasks", async () => {
    const target = controller();
    await expect(target.registerGoodsWatcher("YahooFleamarket", "*/10 * * * *", undefined, undefined, { keyword: "缶バッジ", epoch: 4 })).rejects.toThrow();
    expect(target.hunterRouteService.hireNewHunterForUser).not.toHaveBeenCalled();
  });

  it("preserves the platform type through the authorized update path", async () => {
    const target = controller();
    await target.updateGoodsWatcher("task-id", "YahooFleamarket", { keyword: "缶バッジ", maxPrice: 1500 }, "*/20 * * * *", undefined, undefined);
    expect(target.goodsService.updateTask).toHaveBeenCalledWith("task-id", expect.objectContaining({ type: "YahooFleamarket", searchCondition: expect.objectContaining({ maxPrice: 1500 }) }));
    await target.unregisterGoodsWatcher("task-id", "YahooFleamarket");
    expect(target.goodsService.deleteTask).toHaveBeenCalledWith("task-id", "YahooFleamarket");
  });

  it("dispatches the new platform independently of Yahoo auctions", async () => {
    const route = new HunterRouteService();
    const makeHunter = () => ({ hire: jest.fn(), transfer: jest.fn(), dismiss: jest.fn(), getCronList: jest.fn().mockResolvedValue([]) });
    for (const key of ["mercariHunter", "yahooHunter", "surugayaHunter", "mandarakeHunter", "surveillanceHunter", "yahooFleamarketHunter", "xianyuHunter"]) {
      route[key] = makeHunter();
    }
    const info = { type: "YahooFleamarket" as const, user: { email: "owner@example.invalid" }, searchCondition: { keyword: "谷子" }, schedule: "*/10 * * * *" };
    await route.hireNewHunterForUser({} as any, info);
    await route.transferHunter("task-id", info);
    await route.dismissHunter("task-id", info.type);
    await route.getCronList(info.user.email);
    expect(route.yahooFleamarketHunter.hire).toHaveBeenCalledTimes(1);
    expect(route.yahooFleamarketHunter.transfer).toHaveBeenCalledWith("task-id", info);
    expect(route.yahooFleamarketHunter.dismiss).toHaveBeenCalledWith("task-id");
    expect(route.yahooFleamarketHunter.getCronList).toHaveBeenCalledWith(info.user.email);
    expect(route.yahooHunter.hire).not.toHaveBeenCalled();
    expect(route.yahooHunter.transfer).not.toHaveBeenCalled();
    await route.hireNewHunterForUser({} as any, { ...info, type: "Yahoo" });
    expect(route.yahooHunter.hire).toHaveBeenCalledTimes(1);
  });
});
