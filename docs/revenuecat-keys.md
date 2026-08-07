# How to get the two RevenueCat keys

Right now the app has fake keys:

```
EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY=goog_mock_key   ❌ fake
EXPO_PUBLIC_REVENUECAT_APPLE_KEY=appl_mock_key    ❌ fake
```

Because they are fake, the app runs in **mock mode**. The paywall waits 1.4
seconds, pretends the purchase worked, and gives nothing. This page is how to
get the real ones.

**The keys do not exist yet.** You cannot search for them. RevenueCat creates a
key when you add an app. So the job is: add the app → the key appears.

---

# ANDROID — get `goog_`

## Step 1 · Google Play Console account

Go to **play.google.com/console** → sign up → pay **$25** (one time, forever).

✅ Done when: you can see the Play Console dashboard.

## Step 2 · Create the app

Play Console → **All apps** → **Create app**

- App name: `RizzCoach`
- Package name: **`com.rizzcoach.app`** ← must be exactly this

✅ Done when: the app shows in your app list.

## Step 3 · Upload a build

Play Console → **Testing** → **Internal testing** → **Create new release** →
upload the `.aab` from your EAS build.

This is *not* a public release. Nobody can find your app. It goes live in a few
minutes with no review.

✅ Done when: the release status says **Active**.

## Step 4 · Make a Google service account

This lets RevenueCat check receipts with Google.

1. Go to **console.cloud.google.com**
2. Pick the project linked to your Play account
3. **IAM & Admin** → **Service Accounts** → **Create service account**
4. Name it `revenuecat`
5. Open it → **Keys** → **Add key** → **JSON** → download the file

✅ Done when: you have a `.json` file on your computer.

## Step 5 · Give it permission in Play Console

Play Console → **Users and permissions** → **Invite new user**

- Email: the service account email from the JSON file
  (looks like `revenuecat@your-project.iam.gserviceaccount.com`)
- Permissions: tick **View financial data** and **Manage orders and
  subscriptions**

> ⏱ **Start this step FIRST.**
> Google can take up to **36 hours** to activate the permission. It does not
> need Steps 2 and 3 to be finished, so do it early and continue with the rest
> while you wait.

✅ Done when: the user shows in the list.

## Step 6 · Add the app in RevenueCat

RevenueCat → **Apps** (left menu, bottom) → **+ New** → **Google Play Store**

- Package: `com.rizzcoach.app`
- Upload the `.json` file from Step 4

## 🎉 The key is now ready

RevenueCat → **API keys** → scroll to **SDK API keys** → your app row →
**Show key**

It starts with `goog_`. Copy it.

---

# iOS — get `appl_`

## Step 1 · Apple Developer account

**developer.apple.com** → enrol → pay **$99 per year**.

✅ Done when: you can open App Store Connect.

## Step 2 · Sign the money agreement ⚠️

App Store Connect → **Business** (or *Agreements, Tax, and Banking*)

- Sign the **Paid Applications** agreement
- Fill in your **bank details**
- Fill in your **tax forms**

> ⚠️ **This step blocks everything.**
> Until it says **Active**, your subscriptions will not load at all. The paywall
> just shows grey loading boxes. Most people think RevenueCat is broken — it is
> not, it is this.

✅ Done when: Paid Applications status = **Active**.

## Step 3 · Create the app

App Store Connect → **My Apps** → **+** → **New App**

- Bundle ID: **`com.rizzcoach.chat`** ← must be exactly this

✅ Done when: the app shows in My Apps.

## Step 4 · Make an In-App Purchase key

App Store Connect → **Users and Access** → **Integrations** →
**In-App Purchase** → **+** → download the `.p8` file.

> You can only download this file **once**. Save it somewhere safe.

✅ Done when: you have a `.p8` file.

## Step 5 · Add the app in RevenueCat

RevenueCat → **Apps** → **+ New** → **App Store**

- Bundle ID: `com.rizzcoach.chat`
- Upload the `.p8` file

## 🎉 The key is now ready

RevenueCat → **API keys** → **SDK API keys** → **Show key**

It starts with `appl_`. Copy it.

---

# Where to paste the key

You must paste it in **two** places. One is not enough.

## Place 1 — your computer (for `npx expo start`)

Open the `.env` file in the **project root** (not `backend/.env`), line 19:

```
EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY=goog_paste_it_here
```

## Place 2 — EAS (this is the one that reaches your phone)

```bash
eas env:update --environment preview --name EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY
```

## Then rebuild

```bash
eas build --profile preview --platform android
```

> ⚠️ **`eas update` will NOT work here.**
> The key is baked into the app when it is built. If your installed app was
> built with `goog_mock_key`, it stays in mock mode for ever — no matter how
> many updates you push. You need a **new build**.

---

# Testing the purchase

Two rules, or the purchase always fails:

**1. Install from Google Play, not from the EAS download page.**
Use the internal-testing link. Google checks the app came from Play. A
sideloaded APK can never buy anything.

**2. Add yourself as a license tester.**
Play Console → **Setup** → **License testing** → add your Google account.
Test purchases are free, and subscriptions renew fast so you can watch them:

| Real plan | Test speed |
|---|---|
| Weekly | renews every ~5 minutes |
| Yearly | renews every ~30 minutes |

---

# Quick checklist

**Android**

- [ ] Play Console account ($25)
- [ ] App created — `com.rizzcoach.app`
- [ ] Build uploaded to Internal testing
- [ ] Service account JSON downloaded
- [ ] Service account invited to Play Console ⏱ *do this first, 36h*
- [ ] App added in RevenueCat
- [ ] `goog_` key copied
- [ ] Pasted in root `.env` **and** EAS
- [ ] Rebuilt with `eas build`
- [ ] Installed from the Play link

**iOS**

- [ ] Apple Developer account ($99/yr)
- [ ] Paid Applications agreement **Active** ⚠️ *blocks everything*
- [ ] App created — `com.rizzcoach.chat`
- [ ] `.p8` key downloaded
- [ ] App added in RevenueCat
- [ ] `appl_` key copied
- [ ] Pasted in root `.env` **and** EAS
- [ ] Rebuilt

---

**Do Android first.** It is faster, and iOS is stuck behind the money agreement
which nobody can speed up.

Next step after the keys work: create the two subscriptions
($6.99/week, $79.99/year) and attach them to the `pro` entitlement —
see [revenuecat.md](revenuecat.md).
