import { createApp, close } from "@midwayjs/mock";
import { Framework } from "@midwayjs/web";
import { Application } from "egg";
import { EmailService } from "../../src/service/email";
import CipherServive from "../../src/service/cipher";
import { HunterRouteService } from "../../src/service/hunterRouteService";
import { SurveillanceHunterService } from "../../src/service/hunterArsenal/surveillance";
import { User } from "../../src/model/user";
import { SurveillanceRecord } from "../../src/model/surveillanceRecord";
import { v4 } from "uuid";
import { DatabaseTransactionWrapper } from "../../src/utils/databaseTransactionWrapper";

describe("service/hunterArsenal", () => {
    
    const email = "user@email.com";

    let app: Application;

    let emailService: EmailService;

    let cipher: CipherServive;
    let hunterRouteService: HunterRouteService;
    let databaseTransactionWrapper: DatabaseTransactionWrapper;
  
    beforeAll(async () => {
        app = await createApp<Framework>();
        emailService = await app.getApplicationContext().getAsync(EmailService);
        cipher = await app.getApplicationContext().getAsync(CipherServive);
        hunterRouteService = await app.getApplicationContext().getAsync(HunterRouteService);
        databaseTransactionWrapper = await app.getApplicationContext().getAsync("databaseTransactionWrapper");
        await databaseTransactionWrapper({
            pending: async (queryRunner) => {
                const testUser = new User();
                testUser.email = email;
                testUser.password = "1234";
                await queryRunner.manager.save(testUser);
            },
        })

    });
  
    afterAll(async () => {
        await databaseTransactionWrapper({
            pending: async (queryRunner) => {
                queryRunner.manager.delete(User, { email })
            }
        })
        await close(app);
    });

    it("test surveillance hunter", async () => {
        const uuid = v4();
        await databaseTransactionWrapper({
            pending: async (queryRunner) => {
                const user = await queryRunner.manager.findOne(
                    User,
                    { email },
                    { relations: ["surveillanceRecords"] }
                );
                const newHunter = new SurveillanceRecord();
                newHunter.hunterInstanceId = uuid;
                newHunter.schedule = "* * * * *";
                newHunter.searchConditionSchema = JSON.stringify({
                    type: "mercari",
                    goodId: "m76591871603"
                });
                user.surveillanceRecords.push(newHunter);
                await queryRunner.manager.save(user);
            },
        });
        const surveillanceHunterService = await app.getApplicationContext().getAsync(SurveillanceHunterService);
        await surveillanceHunterService.goHunt(uuid);
        expect(true).toBe(true);
    });
})