import { test, expect } from "@playwright/test";
test("demo covers navigation, book filtering, detail, exports, statistics, budgets and logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "登录你的钱迹账号" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "体验演示账本" }).click();
  await expect(
    page.getByRole("heading", { name: "收支一目了然" }),
  ).toBeVisible();
  await expect(page.locator(".summary-card").first()).toContainText("净支出");
  await expect(page.locator(".bill-table tbody tr")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/desktop-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "账单明细", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "账单明细", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索备注" }).fill("咖啡");
  await expect(page.locator(".bill-table tbody")).toContainText("咖啡");
  await expect(page.locator(".bill-table tbody tr")).not.toHaveCount(0);
  await page.locator(".bill-name").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("账单 ID");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("qianji-bills.json");
  await page.getByRole("textbox", { name: "搜索备注" }).fill("不存在的备注");
  await expect(page.getByText("没有找到符合条件的账单")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page
    .getByRole("combobox", { name: "选择账本" })
    .selectOption("81000000000001000");
  await expect(page.locator(".bill-table tbody")).toContainText("旅行账本");
  await page.getByRole("button", { name: "收支统计", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "其他资金变动" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "按月", exact: true }).click();
  await expect(page.getByRole("heading", { name: "期间明细" })).toBeVisible();
  await page.getByRole("button", { name: "预算", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "总预算", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "年度", exact: true }).click();
  await expect(page.getByText("72,000.00")).toBeVisible();
  await page.getByRole("button", { name: "账本与资料", exact: true }).click();
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await expect(page.getByText("日常储蓄卡")).toBeVisible();
  await page.getByRole("button", { name: "币种", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "美元", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "写入功能验证状态" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录你的钱迹账号" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile navigation, readable layout and detail dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "体验演示账本" }).click();
  await expect(
    page.getByRole("heading", { name: "收支一目了然" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "账单明细", exact: true }).click();
  await page.locator(".bill-name").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThan(391);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("account login auto-syncs and test write confirmation survives refresh without duplicate form", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "邮箱", exact: true })
    .fill("browser@example.com");
  await page.getByLabel("密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "登录并连接" }).click();
  await expect(page.getByRole("alert")).toContainText("登录失败");
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "登录并连接" }).click();
  await expect(
    page.getByRole("heading", { name: "收支一目了然" }),
  ).toBeVisible();
  await expect(page.locator(".bill-table tbody tr")).toHaveCount(6);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "连接当前账号到 MCP", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "断开 MCP 连接", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "断开 MCP 连接", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Tunnel ID", { exact: true })
    .fill("tunnel_00000000000000000000000000000003");
  await page
    .getByLabel("Tunnel 运行密钥", { exact: true })
    .fill("TEST_ONLY_BROWSER_TUNNEL_KEY");
  await page
    .getByRole("button", { name: "保存并连接 Tunnel", exact: true })
    .click();
  await expect(page.getByText("已就绪", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByLabel("Tunnel 运行密钥", { exact: true })).toHaveValue(
    "",
  );
  await page.reload();
  await expect(page.getByLabel("Tunnel ID", { exact: true })).toHaveValue(
    "tunnel_00000000000000000000000000000003",
  );
  await expect(page.getByLabel("Tunnel 运行密钥", { exact: true })).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "停用 Tunnel", exact: true }).click();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.getByText("已就绪", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/mobile-tunnel.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "删除 Tunnel 配置", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除配置", exact: true }).click();
  await expect(page.getByLabel("Tunnel ID", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "断开 MCP 连接", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "连接当前账号到 MCP", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "测试账本", exact: true })
    .selectOption("81000000000001000");
  await page.getByRole("button", { name: "保存测试账本" }).click();
  await page.getByRole("button", { name: "账单明细", exact: true }).click();
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("真实写入测试账本");
  await dialog.getByLabel("金额（CNY）").fill("0.10");
  await dialog
    .getByRole("combobox", { name: "分类", exact: true })
    .selectOption("101");
  await dialog.getByLabel("备注", { exact: true }).fill("浏览器测试账单");
  await dialog.getByRole("button", { name: "确认测试写入" }).click();
  await expect(dialog).toContainText("本次操作核验通过");
  await expect(
    dialog.getByRole("button", { name: "确认测试写入" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("combobox", { name: "选择账本" })
    .selectOption("81000000000001000");
  await page.getByRole("textbox", { name: "搜索备注" }).fill("浏览器测试账单");
  await expect(page.locator(".bill-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".bill-table tbody")).toContainText("0.10");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "账单明细", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录你的钱迹账号" }),
  ).toBeVisible();
});
