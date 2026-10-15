# Zero-involvement re-rank (added Oct 15, 2026, 7:00 PM ET)

Published prices in this copy are ranges in words. Exact figures were removed before filing.
Research only. No one was contacted and nothing was bought or signed up for. The constraints are unchanged: no biotech, pharma, finance or investing; about a couple of thousand to start; low risk of conflict with his CFO role.
Labels: **Fact** = backed by the URL given. **Estimate** = my assumption. **Unverified** = not confirmed. All revenue figures are Estimates. On URL checks: every URL below loaded with HTTP 200 on 2026-10-15 except the Etsy pages. Those returned 403 to an automated fetch (bot blocking), but their text was confirmed through the search index.

## Platform rules that set the floor on human involvement (Facts)
- **Stripe:** To pay out, Stripe must collect and verify identity information about the person or business. It may ask for a scan of a government-issued ID and/or proof of address (https://docs.stripe.com/connect/identity-verification). Gumroad's payouts run on Stripe as well: US sellers must give an SSN, Stripe verifies identity after sales build up, and buying your own product to speed up review can get the account banned (https://gumroad.com/help/article/13-getting-paid).
- **Gumroad:** Since Jan 1, 2025 Gumroad has been the merchant of record and collects and remits sales tax on all sales (https://gumroad.com/help/article/121-sales-tax-on-gumroad). Fees are 10% + a few cents on direct sales and 30% on sales through Discover (https://gumroad.com/pricing). Income tax remains his responsibility (Estimate).
- **Etsy:** Items must be made, designed, handpicked or sourced by the seller. Listings must disclose AI use, and photos must be the seller's own, with limited exceptions (https://www.etsy.com/legal/sellers/). Seller-prompted AI art is allowed if disclosed, and selling prompt bundles is prohibited (https://www.etsy.com/seller-handbook/article/1275449912004). Apps that use the API have to agree to Etsy's API Terms (https://www.etsy.com/legal/api/).
- **Shopify:** The Terms bar accessing or monitoring the Services "using any robot, spider, scraper, or other automated means" (https://www.shopify.com/legal/terms). Bots should therefore work through Shopify's official apps and APIs, never by scraping the admin (Estimate). The Acceptable Use Policy prohibits spam, deceptive practices and IP infringement (https://www.shopify.com/legal/aup).
- **Amazon KDP:** Sellers must tell Amazon about AI-generated text, images or translations, even when the output was heavily edited afterward (https://kdp.amazon.com/en_US/help/topic/G200672390).
- **Google Search:** Under the "Scaled content abuse" policy, it is a violation to use "generative AI tools ... to generate many pages without adding value for users" (https://developers.google.com/search/docs/essentials/spam-policies; see also https://developers.google.com/search/docs/fundamentals/using-gen-ai-content).
- **Ad accounts:** Google Ads advertiser verification asks for identity or business documents, and an account can be paused if verification is not completed (https://support.google.com/adspolicy/answer/9870201?hl=en). Meta's process: Unverified.

## Re-ranked options (most automatable first)

| Rank | Option | Automation (Estimate) | 6-mo / 12-mo revenue per month (Estimate) | Startup (Estimate) |
|---|---|---|---|---|
| 1 | Digital templates/planners on Gumroad + a Vercel site (golf trip kits, family-travel planners, kids' trip journals) | ~90% | a couple of hundred to several hundred / several hundred to a couple of thousand | several hundred to around a thousand |
| 2 | Print-on-demand golf/travel merch (Shopify + a POD app such as Printful) | ~80% | a couple of hundred to several hundred / several hundred to a couple of thousand net | several hundred to a couple of thousand |
| 3 | Niche content site + affiliate links (golf trips, family travel) | ~75% | a token amount to a couple of hundred / a couple of hundred to around a thousand | a couple of hundred to around a thousand |
| 4 | KDP low-content books (golf scorebooks, kids' travel journals) | ~70% | a token amount to a couple of hundred / a couple of hundred to several hundred | a couple of hundred to several hundred |
| 5 | Etsy digital/AI art shop | ~60% | under a hundred to several hundred / a couple of hundred to around a thousand | a couple of hundred to several hundred |

### 1. Gumroad digital products + Vercel landing site (top pick)
- **What the bots do:** Timmy builds the site on Vercel and lists the products. AI drafts the products and the human-reviewed QA is done by bots. A bot answers FAQ emails and writes the posts. DeNiro reconciles payouts.
- **Why it ranks first:** Gumroad is the merchant of record, so sales tax is handled for him (Fact, above). Products are delivered instantly. Nothing ships and inventory doesn't exist.
- **Where a human is still required:** One-time identity, SSN and bank setup and any Stripe re-verification (Fact, above); his tax return (Estimate); approving refunds and disputes (Estimate).
- **Assumptions:** 6 mo: 15–40 sales/mo × a token amount avg, mostly from Pinterest and SEO. 12 mo: 30–100 sales/mo plus bundles at a token amount. All Estimate.
- **Failure risks:** Getting no traffic (the biggest risk); a crowded template market; low-quality AI output leading to refunds. Estimate.

### 2. Print-on-demand merch
- **What the bots do:** Generate designs, make listings and mockups, create Pinterest pins, and pass orders to the POD partner automatically. Estimate.
- **Where a human is still required:** Shopify Store Owner account and Shopify Payments KYC (Facts, above), handling chargebacks and quality complaints, and sales-tax registration. Shopify may help with tax, but how far it does is Unverified. Margins are thin, around a token amount per item. Estimate.
- **Risks:** Trademark and IP problems (golf brands, course names) under the AUP; ad spend needed to get traffic; returns.
- **Assumptions (Estimate):** 12 mo: 60–150 orders/mo × ~a token amount margin.

### 3. Niche content + affiliate site
- **What the bots do:** Research, write, publish on Vercel, and add internal links.
- **Where a human is still required:** Signing up for affiliate programs (each usually needs identity and tax forms, Unverified for specific programs). A human should also review content quality; mass-produced AI pages are exactly what Google's scaled-content-abuse policy targets (Fact, above).
- **Risks:** SEO takes 6–12+ months; core updates can remove traffic overnight. Estimate.

### 4. KDP low-content books
- Bots make the interiors and covers. AI generation must be disclosed (Fact, above). A human handles KDP tax and identity setup. The risks are low prices, oversaturation, and quality enforcement (https://kdp.amazon.com/en_US/help/topic/G200672390). Estimate.

### 5. Etsy digital/AI art
- Etsy's own policies get in the way of a fully bot-run shop: listings must disclose AI, photos must be the seller's own, and the creative input has to come from the seller (Facts, above). There is a real risk of suspension if the shop looks automated or mass-produced (Estimate). Ranked last for that reason.

## Is "zero involvement" realistic? (candid verdict)
**Not literally.** Every payments platform, marketplace and ad network ties the account to a verified human or legal entity (Stripe, Gumroad, Google Ads, Shopify: Facts above). Bots cannot legally pass KYC on his behalf, sign tax forms, or be the account owner. The realistic floor (Estimate):
- **One-time setup, ~3–5 hrs:** optional LLC/EIN (an NC LLC is a small cost; exact fee Unverified), bank account, Stripe/Gumroad identity and SSN, platform terms acceptance, and the employer outside-activity approval below.
- **Ongoing, ~1 hr/month:** clear KYC or re-verification prompts, approve refunds and escalations above a set threshold, do a quick review of new products, and check the payout summary DeNiro prepares.
- **Annually, ~2–3 hrs:** taxes (Schedule C or LLC return) with his accountant.
- He must stay the accountable owner; the bots act as his staff, never his identity. Anything that fakes human activity breaks platform rules and puts the account at risk: bot-created accounts, purchased reviews, scraping the Shopify admin, or mass-produced AI pages. Estimate, based on the policies above.
- **Revenue reality:** With near-zero human involvement, the most likely 12-month outcome is low hundreds to roughly a couple of thousand a month. Getting traffic is the bottleneck, not production. Estimate.

**Recommendation:** Option 1, Gumroad + a Vercel site selling golf-trip and family-travel planner kits, with print-on-demand (option 2) added in month 4–6 if digital sales show demand. Before launch, the employer conflict check below still applies: outside-activity approval, no employer resources, no employer name, then check the code of conduct and talk to the GC.

---
# Prior analysis (Oct 15, 2026, earlier version)
# Online Side-Business Ideas for Naresh Tanna (Oct 15, 2026)
Research only. No one was contacted and nothing was bought or signed up for. Following the scope change, this brief leaves out biotech, pharma, CFO/finance advisory and investing content entirely.
Labels: **Fact** = backed by the URL given (each loaded with HTTP 200 on 2026-10-15). **Estimate** = my assumption. Every revenue figure is an Estimate.

## Ranking criteria
Expected revenue per hour of his time, whether it works on about 5 hrs/week, and conflict risk. All four ideas are outside his job, so conflict risk is low for each.

| Rank | Idea | Price | 12-mo revenue/mo (Estimate) | His hrs/wk | Conflict risk |
|---|---|---|---|---|---|
| 1 | Golf-trip itinerary membership (Carolinas first) | a token amount a year + a couple of hundred custom plan | ~a couple of thousand to a few thousand | 3–5 | Low |
| 2 | AI-assisted family travel itineraries (families with tweens) | a couple of hundred to several hundred/trip | ~a couple of thousand to a few thousand | 4–5 | Low |
| 3 | AI-literacy mini-course for kids 10–14 (built with his sons) | under a hundred cohort / a token amount a month | ~around a thousand to a few thousand | 3–5 | Low |
| 4 | AI-agent/automation template store (n8n) | a token amount to under a hundred/template | ~several hundred to a couple of thousand | 2–4 | Low |

Ranking logic (Estimate): #1 earns recurring revenue from digital products, AI can do most of the research, and his golf credibility helps sell it. #2 earns more per sale but takes more of his own time per client, which caps revenue per hour. #3 is a strong family story but sales are seasonal. #4 has the least of his time per sale, but the marketplaces are crowded and there is little that sets him apart.

---
## 1. Golf-trip itinerary membership + custom trip plans
- **Customer/problem:** Groups of buddies or couples planning golf trips (Pinehurst, Myrtle Beach, Kiawah, then national destinations) who lose hours on research. Estimate.
- **Offer/price:** A token amount a year membership with destination guides and toolkits (tee-time organizer, expense splitter), plus a couple of hundred custom group plan. Estimate. Comparable pricing: 18Away charges a token amount a year for 6 three-day itineraries including Pinehurst (Fact: https://www.18away.com/18away-club-membership/), and The Inside Loop charges a token amount a month (Fact: https://insideloop.golf/subscribe).
- **First 100 customers:** Free weekly newsletter (beehiiv/Substack), SEO pages such as "Pinehurst 3-day golf trip itinerary", golf subreddits and Facebook groups, his own golf network, and affiliate/partner links with lodging. Estimate. Golf Trip Guide's free newsletter claims 4,000+ subscribers (Fact: https://newsletter.golftripguide.com/).
- **Startup cost (Estimate, ~around a thousand to a couple of thousand):** domain + site a couple of hundred; newsletter/email platform a token amount to several hundred in year 1; Stripe a token amount setup; design/templates a couple of hundred; AI tool subscriptions a couple of hundred a year; small paid tests several hundred.
- **Revenue (Estimate):** 6 mo: 60 members (a couple of hundred a month amortized) + 3 custom plans/mo (several hundred) ≈ **around a thousand a month**. 12 mo: 300 members (~around a thousand a month) + 8 custom plans/mo (~around a thousand) + affiliate ~several hundred ≈ **a few thousand a month** (range a couple of thousand to a few thousand). Assumes a free list growing to about 3,000 with roughly 10% converting to paid.
- **His time:** 3–5 hrs/wk. He reviews and adds course insights; the bots draft.
- **AI leverage:** Timmy builds the site, member hub and toolkit. AI drafts guides from public course info, and he edits for accuracy. DeNiro tracks Stripe revenue and expenses.
- **Risks:** Low barrier to entry and established competitors; stale tee-time and price information; affiliate income can be thin. Estimate.
- **Comparables:** https://www.18away.com/18away-club-membership/ · https://insideloop.golf/subscribe · https://newsletter.golftripguide.com/

## 2. AI-assisted custom family-travel itineraries
- **Customer/problem:** Busy dual-income families with kids ages 8–14 who want a vetted, paced plan without paying a full-service agent. Estimate.
- **Offer/price:** a couple of hundred (up to 4 days), several hundred (up to 7 days), several hundred or more (multi-destination), plus an under a hundred "itinerary audit". Estimate. Comparable pricing: Gabbetts On The Go charges under a hundred/a couple of hundred/several hundred/around a thousand or more (Fact: https://gabbettsonthego.com/family-travel-planning/), Roots & Routes charges several hundred and several hundred (Fact: https://www.rootsandroutestravel.co/services-content), and Grand Itinerary Travel charges a couple of hundred to several hundred per trip (Fact: https://granditinerarytravel.com/service-fee-schedule/).
- **First 100 customers:** Instagram/Pinterest posts on "real trip with our boys", a free sample itinerary as a lead magnet, Cary/Triangle parent groups and school networks, and referrals. Estimate.
- **Startup cost (Estimate, ~around a thousand to a couple of thousand):** site + intake form a couple of hundred; Google Docs/Canva templates a couple of hundred; AI tools a couple of hundred a year; ads/tests several hundred to around a thousand.
- **Revenue (Estimate):** 6 mo: 4 trips/mo × several hundred avg ≈ **around a thousand a month**. 12 mo: 12 trips/mo × several hundred ≈ **a few thousand a month** (range a couple of thousand to a few thousand). Assumes AI cuts build time to about 1–1.5 hrs of his review per trip.
- **His time:** 4–5 hrs/wk. This is the binding constraint, so volume tops out at roughly 12–15 trips/mo without a contractor.
- **AI leverage:** An agent takes in the intake form and drafts a day-by-day plan with booking links, and he does the QA. Timmy automates intake, payment and delivery.
- **Risks:** Hours grow with sales; liability if bookings go wrong (offer plans only, no bookings); client service intrudes on his time. Estimate.
- **Comparables:** URLs above, plus https://hookedonhiatus.com/custom-family-travel-planning/ (search result; not separately curl-checked).

## 3. "AI for Kids 10–14" family-built mini-course
- **Customer/problem:** Parents who want their tweens to use AI safely and creatively. Estimate.
- **Offer/price:** A under a hundred 8-session recorded or live cohort, or a token amount a month project club. Estimate. Comparable pricing: KidsFunLearnClub charges under a hundred for its founding cohort (Fact: https://kidsfunlearnclub.co/courses/ai-for-kids/), Bit&R charges a token amount a month (Fact: https://www.bitandr.com/), and Syncho charges a token amount a month (Fact: https://www.syncho.ai/).
- **First 100 customers:** Local parent networks, homeschool groups, YouTube shorts made with his sons, and summer and holiday cohorts. Estimate.
- **Startup cost (Estimate, ~around a thousand to a couple of thousand):** course platform a token amount to under a hundred a month; mic/camera a couple of hundred; curriculum design a token amount (AI + him); ads several hundred to around a thousand.
- **Revenue (Estimate):** 6 mo: 1 cohort of 10 ≈ **several hundred a month** averaged. 12 mo: 2 cohorts/quarter of 15 + 50 club members ≈ **a couple of thousand a month** (range around a thousand to a few thousand).
- **His time:** 3–5 hrs/wk, with spikes when live cohorts run.
- **AI leverage:** AI writes the curriculum and kid-safe project templates; Timmy builds the platform.
- **Risks:** Child privacy rules (COPPA) and parental-consent obligations; seasonal demand; competing with free resources. Estimate.

## 4. AI-agent / automation template store
- **Customer/problem:** Small businesses that want ready-made n8n/Make workflows. Estimate.
- **Offer/price:** a token amount to under a hundred per template, listed on marketplaces and on his own site. Comparable terms: Neura Market lets sellers keep 90% with no listing fee (Fact: https://www.neura.market/sell-n8n-workflows), AutomationWorkflows pays 85% (Fact: https://automationworkflows.io/), and n8nplace pays an 80% revenue share and lists 9,200+ templates (Fact: https://n8nplace.com/).
- **First 100 customers:** Marketplace search, plus a YouTube/LinkedIn post for each template. Estimate.
- **Startup cost (Estimate, ~several hundred to around a thousand):** n8n hosting a token amount to a couple of hundred a year; site a couple of hundred; AI APIs a couple of hundred.
- **Revenue (Estimate):** 6 mo: 10 sales × under a hundred ≈ **several hundred a month net**. 12 mo: 30 sales × under a hundred × 0.85 ≈ **a couple of thousand a month** (range several hundred to a couple of thousand).
- **His time:** 2–4 hrs/wk. Timmy can build most of it.
- **AI leverage:** Very high. This is close to fully bot-built.
- **Risks:** A crowded market (thousands of templates); support requests; templates break when platforms change. Estimate.

---
## Day-job conflict check (general, not legal advice)
- **Outside-activity / conflict-of-interest policy:** Public companies commonly require executives to disclose outside business activities, and some require formal approval. Get written approval before launch. Estimate (general practice).
- **No employer time or resources:** Do the work on personal time, with personal devices, accounts and email, and keep it off company systems.
- **Don't use the employer's name** or his title in marketing, bios or ads.
- **Reputational risk:** A public-company executive's side venture gets scrutiny. Keep it clearly separate from his role, professional in tone, and free of anything that could embarrass the company or distract from his duties.
- **Action:** Read the company's code of conduct and talk to the general counsel before launching any idea.

## Top recommendation
Start with **#1, the golf-trip membership**, and add **#2's custom plans** as an upsell: golf groups and families both buy itineraries, so one site and one AI pipeline can serve both. Start in the Carolinas, build the free newsletter first, and turn on paid tiers once the list passes about 1,000 subscribers. Estimate.
