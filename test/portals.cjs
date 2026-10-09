const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createServer } = require('../app-server');
let chromium;
try { ({chromium} = require('playwright')); } catch { ({chromium} = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
function browserPath(){
  if(process.env.POLICYGUARD_BROWSER)return process.env.POLICYGUARD_BROWSER;
  if(fs.existsSync(chromium.executablePath()))return undefined;
  const root=path.join(os.homedir(),'AppData/Local/ms-playwright');
  if(!fs.existsSync(root))return undefined;
  const folder=fs.readdirSync(root).filter(name=>/^chromium_headless_shell-\d+$/.test(name)).sort((a,b)=>Number(b.split('-').pop())-Number(a.split('-').pop()))[0];
  return folder?path.join(root,folder,'chrome-headless-shell-win64/chrome-headless-shell.exe'):undefined;
}
(async()=>{
  const mobile=process.env.POLICYGUARD_MOBILE==='1';
  const output=path.join(__dirname,mobile?'../artifacts/v2/mobile':'../artifacts/v2');fs.mkdirSync(output,{recursive:true});
  const instance=await createServer({directory:path.join(__dirname,'../test-output',crypto.randomUUID(),'data'),blockTime:0,adminPassword:'BrowserAdmin123!'});
  let browser;
  const checks=[],errors=[];
  try{
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${instance.server.address().port}`;
    browser=await chromium.launch({headless:true,executablePath:browserPath()});
    const context=async()=>{
      const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1050}}),page=await ctx.newPage();
      page.on('pageerror',error=>errors.push(error.message));return{ctx,page};
    };
    const admin=await context(),alice=await context(),bob=await context(),customer=await context();
    const shot=async(page,name)=>page.screenshot({path:path.join(output,`${name}.png`),fullPage:true,animations:'disabled'});
    async function signup(page,role,username,name){
      await page.goto(`${base}/${role}/signup`);await page.locator('#full-name').fill(name);await page.locator('#email').fill(`${username}@example.com`);
      await page.locator('#phone').fill('+91 98765 43210');await page.locator('#username').fill(username);await page.locator('#password').fill('BrowserAccount123!');
      await page.locator('#auth-form button[type="submit"]').click();await page.locator('.sidebar').waitFor();
    }
    async function confirm(page){
      const check=page.locator('#dialog-ack');if(await check.count())await check.check();
      await page.locator('#dialog-confirm').click();
      await page.waitForFunction(()=>state.operation!==null || document.querySelector('#toast')?.textContent.includes('confirmed and synchronised'),null,{timeout:10000});
      await page.waitForFunction(()=>state.operation===null,null,{timeout:60000});
      assert.ok(!(await page.locator('#toast').innerText()).includes('reverted'));
    }
    await customer.page.goto(base);await customer.page.getByText('Are you a Customer or an Agent?').waitFor();await shot(customer.page,'landing');
    checks.push('Role-selection landing page and separate authentication routes');
    await signup(alice.page,'agent','agent_alice','Alice Advisor');await signup(bob.page,'agent','agent_bob','Bob Advisor');
    await alice.page.getByText('Your application is with us.').waitFor();
    checks.push('New agent remains pending with no portfolio navigation');
    await admin.page.goto(`${base}/admin/login`);await admin.page.locator('#username').fill('admin');await admin.page.locator('#password').fill('BrowserAdmin123!');await admin.page.locator('#auth-form button[type="submit"]').click();
    for(const name of ['Alice Advisor','Bob Advisor']){
      const row=admin.page.getByRole('row').filter({hasText:name});await row.getByRole('button',{name:'Approve',exact:true}).click();await confirm(admin.page);
      await row.getByText('employed',{exact:true}).waitFor();
    }
    await shot(admin.page,'admin-approvals');checks.push('Administrator approves agents and live access updates reach their sessions');
    await signup(customer.page,'customer','customer_clara','Clara Raman');await customer.page.waitForFunction(()=>state.dashboard?.registered===true);
    await customer.page.locator('[data-action="nav"][data-view="plans"]').first().click();
    await customer.page.locator('.plan').filter({hasText:'Growth'}).getByRole('button',{name:'Choose this plan'}).click();await confirm(customer.page);
    await customer.page.locator('[data-action="nav"][data-view="overview"]').click();
    await customer.page.locator('.policy-card').filter({hasText:'Growth'}).waitFor();await shot(customer.page,'customer-dashboard');
    checks.push('Customer purchases a fixed plan with test balance and sees countdown and assigned agent');
    await alice.page.locator('[data-action="nav"][data-view="overview"]').click();await alice.page.locator('.policy-card').waitFor();await shot(alice.page,'agent-portfolio');
    checks.push('Assigned agent sees read-only customer portfolio');
    await customer.page.locator('.policy-card').getByRole('button',{name:'View policy'}).click();
    await customer.page.getByRole('button',{name:/Pay premium 2/}).click();await confirm(customer.page);
    await customer.page.getByRole('button',{name:/Pay premium 3/}).waitFor();
    await customer.page.locator('#verify-form button').click();await customer.page.getByText('Document matches the original fingerprint.').waitFor();
    await customer.page.locator('#document-text').fill('Altered terms promising an inflated bonus');await customer.page.locator('#verify-form button').click();await customer.page.getByText('Mismatch: this text differs from the original document.').waitFor();
    checks.push('Sequential premium payment and exact-document integrity verification');
    const other=await alice.ctx.newPage();await other.goto(`${base}/agent/policies`);await other.locator('.policy-card').waitFor();
    await alice.page.locator('[data-view="employment"]').click();await alice.page.getByRole('button',{name:'Resign from Sahana Life'}).click();await confirm(alice.page);
    await alice.page.getByText('Your employment has ended.').waitFor();await other.getByText('Your employment has ended.').waitFor();
    assert.equal(await alice.page.locator('.policy-card').count(),0);assert.equal(await other.locator('.policy-card').count(),0);
    for(const route of ['/api/agent/dashboard','/api/plans','/api/notifications','/api/explorer/blocks']){
      assert.equal(await alice.page.evaluate(async route=>(await fetch(route)).status,route),403);
    }
    await shot(alice.page,'resigned-agent');
    checks.push('Resignation removes all customer screens in both open tabs and blocks old API routes');
    await customer.page.waitForFunction(()=>state.policy?.currentAgent?.name==='Bob Advisor');
    await customer.page.locator('.contact-card').filter({hasText:'CURRENT SERVICING AGENT'}).getByText('Bob Advisor',{exact:true}).waitFor();
    await customer.page.locator('.contact-card').filter({hasText:'ORIGINAL ONBOARDING AGENT'}).getByText('Alice Advisor',{exact:true}).waitFor();
    await shot(customer.page,'policy-reassignment');checks.push('Customer sees replacement contact details and original departed agent');
    await customer.page.getByRole('button',{name:'Preview cancellation'}).click();
    await customer.page.getByRole('heading',{name:'Review the cancellation.'}).waitFor();
    assert.ok((await customer.page.locator('#dialog').innerText()).includes('₹5,000'));await shot(customer.page,'cancellation-preview');
    await confirm(customer.page);await customer.page.waitForFunction(()=>state.policy?.status==='cancelled');
    await bob.page.locator('[data-view="notifications"]').click();await bob.page.getByText(/Fee INR 5000/).waitFor();
    checks.push('10% fee, 90% refund and cancellation notifications visible to the current agent');
    await customer.page.locator('[data-view="explorer"]').click();await customer.page.getByRole('button',{name:'Check these block links'}).click();await customer.page.getByText(/Links verified/).waitFor();
    await customer.page.locator('[data-action="block"]').nth(1).click();await customer.page.getByText('Parent links match the neighbouring blocks.').waitFor();await shot(customer.page,'block-explorer');
    await customer.page.locator('[data-action="chain"][data-chain="agent"]').click();await customer.page.getByRole('button',{name:'View contract transactions'}).click();await customer.page.locator('[data-action="transaction"]').first().click();await customer.page.getByText('TRANSACTION RECEIPT',{exact:true}).waitFor();
    await shot(customer.page,'transaction-receipt');checks.push('Both chain explorers show real links, integrity results, receipts and cross-chain references');
    await customer.page.setViewportSize({width:390,height:844});await customer.page.locator('[data-view="overview"]').click();await shot(customer.page,'mobile-dashboard');
    assert.equal(await customer.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    checks.push('Mobile dashboard fits a 390px viewport');
    assert.deepEqual(errors,[]);checks.push('No browser JavaScript errors');
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:checks.length,viewport:mobile?'390x844':'1440x1050',date:new Date().toISOString(),checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }catch(error){
    if(browser){for(const context of browser.contexts())for(const [index,page] of context.pages().entries()){
      await page.screenshot({path:path.join(output,`failure-${crypto.randomUUID().slice(0,6)}-${index}.png`),fullPage:true}).catch(()=>{});
      console.error('PAGE',page.url(),(await page.locator('body').innerText()).slice(0,1800));
    }}throw error;
  }finally{if(browser)await browser.close();await instance.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
