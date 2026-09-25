# Builds the full set of desktop wireframes for the escrow wallet system.
# Run: python build.py  -> writes one HTML page per screen (screenshotted to PNG by render.sh).

S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"'
def svg(body, cls="ico", size=None):
    st = f' style="width:{size}px;height:{size}px"' if size else ""
    return f'<svg class="{cls}"{st} {S}>{body}</svg>'

I = {
    "home": svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    "jobs": svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    "wallet": svg('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2M3 10h18"/>'),
    "user": svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
    "users": svg('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.4 3.5-5 7-5s6.2 1.6 7 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.4 2.2 4 5"/>'),
    "plus": svg('<path d="M12 5v14M5 12h14"/>'),
    "check": svg('<path d="M5 12l5 5 9-10"/>'),
    "lock": svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    "phone": svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
    "alert": svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/>'),
    "pin": svg('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>', size=16),
    "star": svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', size=16),
    "search": svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    "history": svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    "shield": svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    "flag": svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    "upload": svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
    "clock": svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
}

NAV = {
    "Client": [("home", "Home"), ("plus", "Post a Job"), ("wallet", "Wallet"), ("history", "History"), ("shield", "My Trust")],
    "Worker": [("home", "Home"), ("search", "Find Jobs"), ("wallet", "Wallet"), ("history", "History"), ("shield", "My Trust")],
    "Admin": [("home", "Overview"), ("flag", "Disputes"), ("users", "Users"), ("wallet", "Payments")],
}

# ---------------------------------------------------------------- helpers
def page(body, title):
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>'
            f'<link rel="stylesheet" href="wf.css"></head><body>{body}</body></html>')

def frame(role, active, header, content, h=600):
    items = "".join(
        f'<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;font-size:16px;'
        f'{"background:var(--green-tint);color:var(--green-dark);font-weight:bold" if t == active else "color:#444"}">'
        f'<span style="width:22px;height:22px;display:inline-flex">{I[k]}</span>{t}</div>' for k, t in NAV[role])
    return (
        f'<div style="width:1280px;height:{h}px;border:3px solid var(--ink);border-radius:14px;overflow:hidden;display:flex;background:var(--bg)">'
        '<div style="width:230px;background:#fff;border-right:1px solid var(--line);padding:22px 14px;display:flex;flex-direction:column;gap:4px">'
        f'<div class="hello" style="margin:0 0 18px 8px;font-size:20px">{role}</div>{items}</div>'
        '<div style="flex:1;display:flex;flex-direction:column;min-width:0">'
        f'<div style="background:#fff;border-bottom:1px solid var(--line);padding:16px 30px" class="row">{header}<div class="avatar"></div></div>'
        f'<div style="flex:1;padding:22px 30px;display:flex;flex-direction:column;gap:16px">{content}</div></div></div>')

def head(title, sub=""):
    return f'<div><div class="hello">{title}</div>' + (f'<div class="sub">{sub}</div>' if sub else "") + '</div>'

def cols(*cards, gap=16, align="stretch"):
    return f'<div style="display:flex;gap:{gap}px;align-items:{align}">' + "".join(cards) + '</div>'

def card(inner, flex=1, extra=""):
    return f'<div class="card" style="flex:{flex};display:flex;flex-direction:column;{extra}">{inner}</div>'

PUSH = '<div style="flex:1"></div>'

def chip(text, kind="", icon=None):
    ic = I[icon] if icon else ""
    return f'<span class="chip {kind}" style="margin:0;display:inline-flex;gap:5px;align-items:center">{ic}{text}</span>'

TRUST_KIND = {"High": "", "Medium": "amber", "Low": "red"}
def trust(level):
    return chip(f"Trust: {level}", TRUST_KIND[level], "star")

def btn(text, kind="", icon=None, extra=""):
    ic = I[icon] if icon else ""
    return f'<div class="btn {kind}" style="{extra}">{ic}{text}</div>'

def field(label, value, ph=False, hint="", tall=False, select=False):
    arrow = '<span style="color:#6b7280">&#9662;</span>' if select else ""
    cls = "input" + (" ph" if ph else "") + (" tall" if tall else "")
    h = f'<div class="hint">{hint}</div>' if hint else ""
    return f'<div style="flex:1"><div class="flabel">{label}</div><div class="{cls}"><span>{value}</span>{arrow}</div>{h}</div>'

def table(headers, rows):
    th = "".join(f"<th>{x}</th>" for x in headers)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table class="tbl"><tr>{th}</tr>{trs}</table>'

def section(t): return f'<div class="section">{t}</div>'

def steps_track(done_upto, labels=("Paid", "Held safely", "Work done", "Released")):
    items = "".join(
        '<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:6px">'
        f'<div style="width:30px;height:30px;border-radius:50%;border:2px solid var(--green);background:{"var(--green)" if i < done_upto else "#fff"};'
        f'color:#fff;display:flex;align-items:center;justify-content:center;z-index:1">{I["check"] if i < done_upto else ""}</div>'
        f'<div style="font-size:13px;text-align:center;{"font-weight:bold" if i < done_upto else "color:#888"}">{t}</div></div>'
        for i, t in enumerate(labels))
    return ('<div style="display:flex;position:relative">'
            '<div style="position:absolute;left:12%;right:12%;top:15px;height:2px;background:var(--green)"></div>' + items + '</div>')

PAGES = []
def add(name, title, html, h=600):
    PAGES.append((name, title, html, h))

# ================================================================ SHARED
def auth(inner, width=460, h=600):
    return (f'<div style="width:1280px;height:{h}px;border:3px solid var(--ink);border-radius:14px;overflow:hidden;'
            'display:flex;align-items:center;justify-content:center;background:var(--bg)">'
            f'<div class="card" style="width:{width}px;padding:30px 34px;display:flex;flex-direction:column;gap:16px">{inner}</div></div>')

add("login", "Login", auth(
    '<div style="display:flex;justify-content:center"><div class="ph-img" style="width:64px;height:64px;border-radius:16px">LOGO</div></div>'
    '<div style="text-align:center"><div class="hello">Welcome back</div><div class="sub">Log in to see your jobs and money</div></div>'
    + field("Phone number or email", "0712 345 678")
    + field("Password", "&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;", hint='<span style="color:var(--green);font-weight:bold">Forgot password?</span>')
    + btn("Log in", "primary")
    + '<div class="small" style="text-align:center">New here? <b style="color:var(--green)">Create an account</b></div>'))

def role_card(title, sub, on):
    st = "border:2px solid var(--green);background:var(--green-tint)" if on else "border:1.5px solid var(--line)"
    tick = f'<div style="color:var(--green)">{I["check"]}</div>' if on else ""
    return (f'<div style="flex:1;border-radius:12px;padding:16px;{st}" class="row">'
            f'<div><div class="title">{title}</div><div class="small">{sub}</div></div>{tick}</div>')

add("register", "Register", auth(
    '<div><div class="hello">Create your account</div><div class="sub">Step 1: What do you want to do?</div></div>'
    + cols(role_card("I want to hire", "Post jobs and pay safely (Client)", True),
           role_card("I want to work", "Find jobs and get paid (Worker)", False), gap=14)
    + cols(field("Full name", "David Kamau"), field("M-Pesa phone number", "0712 345 678"))
    + cols(field("Country", "Kenya (KES)", select=True, hint="Sets your currency: KES, UGX, TZS or USD"),
           field("Password", "&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"))
    + btn("Create account", "primary")
    + '<div class="small" style="text-align:center">Already have an account? <b style="color:var(--green)">Log in</b></div>',
    width=760, h=640), h=640)

# ================================================================ CLIENT
add("client_dashboard", "Client Dashboard", frame("Client", "Home",
    '<div><div class="hello">Hi, David</div><div style="margin-top:6px">' + trust("High") + '</div></div>',
    cols(card('<div class="label">Wallet balance</div><div class="money">KES 45,000</div>'
              '<div class="small">KES 14,500 held safely for your jobs</div>', 2),
         card('<div class="label">Need help with something?</div><div class="small" style="margin:6px 0 12px">'
              'Describe the job and workers near you can apply.</div>' + PUSH + btn("Post a Job", "dark", "plus"), 1))
    + section("My jobs")
    + cols(card('<div class="title">Fix kitchen sink</div><div style="margin-top:6px">' + chip("4 people applied") + '</div>' + PUSH
                + btn("Choose a worker", "sm", extra="margin-top:16px")),
           card('<div class="title">Paint front gate</div><div style="margin-top:6px">' + chip("Work is done", "dark") + '</div>' + PUSH
                + btn("Check &amp; pay worker", "sm primary", extra="margin-top:16px")),
           card('<div class="title">Wiring repair</div><div style="margin-top:6px">' + chip("In progress", "amber") + '</div>' + PUSH
                + '<div class="small" style="margin-top:16px">Worker: Grace A. &middot; KES 9,000 held safely</div>'))))

add("post_job", "Post a Job", frame("Client", "Post a Job",
    head("Post a Job", "Tell workers what you need done"),
    cols(card(field("Job title", "Fix kitchen sink")
              + '<div style="height:14px"></div>'
              + field("Describe the work", "The sink is leaking under the cupboard and the tap is loose.", tall=True)
              + '<div style="height:14px"></div>'
              + cols(field("Location", "Kilimani, Nairobi"), field("When do you need it done?", "Sat, 20 Jun", select=True))
              + '<div style="height:14px"></div>'
              + cols(field("Currency", "KES", select=True), field("Budget", "3,500", hint="You only pay into escrow after you choose a worker")),
              2),
         card('<div class="label">How payment works</div>'
              + "".join(f'<div class="row" style="justify-content:flex-start;gap:12px;margin-top:14px">'
                        f'<div style="width:30px;height:30px;border-radius:50%;background:var(--green-tint);color:var(--green-dark);'
                        f'font-weight:bold;display:flex;align-items:center;justify-content:center;flex:none">{n}</div>'
                        f'<div style="font-size:15px">{t}</div></div>'
                        for n, t in [(1, "You pay into escrow with M-Pesa"), (2, "The worker does the job"),
                                     (3, "You check the work and release the money")])
              + '<div class="small" style="margin-top:14px">Your money is held safely the whole time.</div>'
              + PUSH + btn("Post Job", "primary", extra="margin-top:16px"), 1)), h=640))

def applicant(name, level, reasons, price, best=False):
    return ('<div class="card row" style="padding:14px 18px">'
            '<div class="row" style="gap:14px;justify-content:flex-start"><div class="avatar sm"></div>'
            f'<div><div class="title">{name}</div><div class="small" style="margin-top:3px">{reasons}</div></div></div>'
            f'<div class="row" style="gap:18px">{trust(level)}<div class="title" style="width:100px;text-align:right">{price}</div>'
            + btn("Choose", "sm primary" if best else "sm", extra="width:120px") + '</div></div>')

add("choose_worker", "Choose a Worker", frame("Client", "Home",
    head("Fix kitchen sink", "4 people applied &middot; Budget KES 3,500"),
    '<div class="card row" style="background:var(--green-tint);border-color:#b7dfc4;justify-content:flex-start;gap:10px;padding:12px 16px">'
    f'<span style="color:var(--green-dark)">{I["shield"]}</span><div style="font-size:15px;color:var(--green-dark)">'
    '<b>Trust level</b> is worked out from each worker&rsquo;s past jobs, disputes and how fast they reply.</div></div>'
    + applicant("Peter Njoroge", "High", "18 jobs done &middot; 0 disputes &middot; replies in about 1 hour", "KES 3,500", True)
    + applicant("Mary Wanjiru", "High", "11 jobs done &middot; 0 disputes &middot; replies in about 2 hours", "KES 3,800")
    + applicant("Tom Otieno", "Medium", "5 jobs done &middot; 1 dispute &middot; replies in about 5 hours", "KES 3,000")
    + applicant("James Mwangi", "Low", "New worker &middot; 1 job done &middot; 1 dispute", "KES 2,500"), h=620))

add("pay_escrow", "Pay into Escrow", frame("Client", "Wallet",
    head("Pay into escrow", "Fix kitchen sink &middot; Worker: Peter Njoroge"),
    cols(card('<div class="label">You are paying</div><div class="money" style="font-size:40px">KES 3,500</div>'
              '<div class="small">&asymp; UGX 100,300 &middot; TZS 70,700 &middot; USD 27</div>'
              f'<div class="card row" style="margin-top:18px;background:var(--green-tint);border-color:#b7dfc4;justify-content:flex-start;gap:10px">'
              f'<span style="color:var(--green-dark)">{I["lock"]}</span><div style="font-size:15px;color:var(--green-dark)">'
              'The worker does not get this money until you say the work is done.</div></div>', 1),
         card(field("Pay from", "M-Pesa", select=True)
              + '<div style="height:14px"></div>' + field("M-Pesa phone number", "0712 345 678")
              + PUSH + btn("Pay KES 3,500 with M-Pesa", "primary", "phone", "margin-top:18px"), 1))
    + card('<div class="row" style="justify-content:flex-start;gap:14px">'
           f'<div style="color:var(--amber)">{I["clock"]}</div><div><div class="title">Check your phone</div>'
           '<div class="small">Enter your M-Pesa PIN on the pop-up to finish paying. This page updates by itself.</div></div></div>',
           flex="none", extra="border-color:#f5c98a;background:var(--amber-tint)")))

add("release_payment", "Release Payment", frame("Client", "Wallet",
    head("Paint front gate", "Worker: Evans Otieno &middot; Trust: High"),
    cols(card(f'<div>{chip("Held safely", "", "lock")}</div>'
              '<div class="money" style="font-size:44px;margin-top:10px">KES 6,000</div>'
              '<div class="small">&asymp; UGX 172,000 &middot; USD 46</div>'
              '<div style="margin-top:30px">' + steps_track(3) + '</div>', 3),
         card('<div class="label">What to do next</div>'
              '<div style="font-size:16px;line-height:1.5;color:#333;margin-top:8px">Evans says the work is done. '
              'Check the work, then release the money. It goes straight to his M-Pesa.</div>' + PUSH
              + btn("Release KES 6,000", "primary", "check", "margin-top:16px")
              + btn("Report a problem", "danger", "alert", "margin-top:12px"), 2))
    + section("Payment activity")
    + '<div class="card" style="padding:6px 18px">' + "".join(
        f'<div class="row" style="padding:11px 0;{"border-top:1px solid var(--line)" if i else ""}">'
        f'<div style="font-size:15px">{what}</div><div class="small">{when}</div></div>'
        for i, (what, when) in enumerate([
            ("You paid KES 6,000 from M-Pesa", "12 Jun, 10:14"),
            ("Money is being held safely until the job is done", "12 Jun, 10:15"),
            ("Evans marked the work as done", "14 Jun, 16:40")])) + '</div>'))

def option(text, on=False):
    dot = ('<div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--green);display:flex;align-items:center;'
           'justify-content:center;flex:none">' + ('<div style="width:10px;height:10px;border-radius:50%;background:var(--green)"></div>' if on else "")
           + '</div>')
    st = "border:2px solid var(--green);background:var(--green-tint)" if on else "border:1.5px solid var(--line)"
    return f'<div style="display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:10px;{st};font-size:15px">{dot}{text}</div>'

add("report_problem", "Report a Problem", frame("Client", "Wallet",
    head("Report a problem", "Paint front gate &middot; KES 6,000 held safely"),
    cols(card('<div class="flabel">What went wrong?</div>'
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
              + option("The work was not finished", True) + option("The work was done badly")
              + option("The worker did not come") + option("Something else") + '</div>'
              + '<div style="height:14px"></div>'
              + field("Tell us more", "Only the front of the gate was painted. The back was not done.", tall=True), 2),
         card('<div class="flabel">Add photos (optional)</div>'
              f'<div class="ph-img" style="height:120px;flex-direction:column;gap:6px">{I["upload"]}Tap to add photos</div>'
              '<div class="card" style="margin-top:14px;background:var(--bg);font-size:14.5px;line-height:1.45">'
              'The money stays held safely. An admin will look at both sides and decide within 2 days.</div>'
              + PUSH + btn("Send to admin", "danger", "flag", "margin-top:16px"), 1)), h=600))

def metric(label, value, note):
    return card(f'<div class="label">{label}</div><div class="money" style="font-size:30px">{value}</div><div class="small">{note}</div>')

def trust_page(role, sub, basis, tips, metrics):
    """'My trust level' screen, shared by clients and workers (the Random Forest output and its inputs)."""
    return frame(role, "My Trust",
        head("My trust level", sub),
        cols(card('<div class="label">Your trust level</div>'
                  '<div class="money" style="color:var(--green)">High</div>'
                  '<div style="display:flex;gap:6px;margin:10px 0 6px">'
                  '<div style="flex:1;height:10px;border-radius:5px;background:#f3b0b0"></div>'
                  '<div style="flex:1;height:10px;border-radius:5px;background:#f5c98a"></div>'
                  '<div style="flex:1;height:10px;border-radius:5px;background:var(--green)"></div></div>'
                  '<div class="row small"><span>Low</span><span>Medium</span><span><b>High</b></span></div>'
                  f'<div class="small" style="margin-top:14px">Updated after every job. {basis}</div>', 1),
             card('<div class="label">How to keep it high</div>' + "".join(
                  f'<div class="row" style="justify-content:flex-start;gap:10px;margin-top:12px;font-size:15px">'
                  f'<span style="color:var(--green)">{I["check"]}</span>{t}</div>' for t in tips), 1))
        + section("What your trust level is based on")
        + cols(*[metric(*m) for m in metrics]))

add("client_trust", "Client Trust Level", trust_page("Client",
    "Workers see this before they apply for your jobs",
    "Worked out from how you pay and treat workers, not from reviews alone.",
    ["Pay into escrow soon after choosing a worker", "Release the money quickly when the work is good",
     "Only report a problem when something really went wrong", "Reply to workers&rsquo; questions quickly"],
    [("Jobs paid in full", "12", "out of 12 jobs"), ("Time to release money", "~6 hrs", "after work is done"),
     ("Refund requests", "1", "in the last 6 months"), ("Disputes", "0", "in the last 6 months")]))

# ================================================================ WORKER
def job_tile(t, l, p, client, level, when=None, applied=False):
    """Job card for workers; shows the client's trust level so workers can judge who they will work for."""
    b = btn("Applied", "sm", "check", "margin-top:14px;border-color:#b7dfc4;color:var(--green-dark);background:var(--green-tint)") if applied \
        else btn("Apply", "sm primary", extra="margin-top:14px")
    needed = f'<div class="small" style="margin-top:2px">Needed: {when}</div>' if when else ""
    return card(f'<div class="row"><div class="title">{t}</div><div class="title">{p}</div></div>'
                f'<div class="small" style="display:flex;align-items:center;gap:3px;margin-top:4px">{I["pin"]}{l}</div>{needed}'
                f'<div class="row" style="margin-top:10px"><span class="small">Client: {client}</span>{trust(level)}</div>' + PUSH + b)

add("worker_dashboard", "Worker Dashboard", frame("Worker", "Home",
    '<div><div class="hello">Hi, Evans</div><div style="margin-top:6px">' + trust("High") + '</div></div>',
    cols(card('<div class="label">Money you can withdraw</div><div class="money">KES 8,200</div>' + PUSH
              + btn("Withdraw to M-Pesa", "primary sm", "phone", "margin-top:12px")),
         card('<div class="label">Your current job</div><div class="title" style="margin-top:6px">Paint front gate</div>'
              '<div class="small" style="margin-top:4px">KES 6,000 is held safely for you</div>' + PUSH
              + btn("I have finished", "sm", "check", "margin-top:12px")),
         card('<div class="label">Your trust level</div><div style="margin-top:8px">' + trust("High") + '</div>'
              '<div class="small" style="margin-top:10px">Finish jobs on time and avoid disputes to keep it high.</div>' + PUSH
              + '<div class="small" style="margin-top:10px;color:var(--green);font-weight:bold">See why &rarr;</div>'))
    + section("New jobs near you")
    + cols(job_tile("Fix kitchen sink", "Kilimani &middot; 2 km", "KES 3,500", "Mary W.", "High"),
           job_tile("Wiring repair", "Westlands &middot; 5 km", "KES 9,000", "John K.", "Medium"),
           job_tile("Tiling a bathroom", "Kileleshwa &middot; 4 km", "KES 7,000", "Ann M.", "High")), h=640))

add("find_jobs", "Find Jobs", frame("Worker", "Find Jobs",
    head("Find jobs", "Jobs posted near you"),
    cols(f'<div class="input ph" style="flex:1"><span style="display:flex;gap:8px;align-items:center">{I["search"]}Search for a job, e.g. plumbing</span></div>',
         f'<div class="input" style="width:230px"><span style="display:flex;gap:6px;align-items:center">{I["pin"]}Near Kilimani</span><span>&#9662;</span></div>')
    + '<div style="display:flex;gap:8px">' + "".join(
        chip(c, "dark" if i == 0 else "grey") for i, c in enumerate(["All", "Plumbing", "Painting", "Electrical", "Cleaning", "Building"])) + '</div>'
    + cols(job_tile("Fix kitchen sink", "Kilimani &middot; 2 km", "KES 3,500", "Mary W.", "High", "Sat, 20 Jun"),
           job_tile("Wiring repair", "Westlands &middot; 5 km", "KES 9,000", "John K.", "Medium", "Mon, 22 Jun", True),
           job_tile("Tiling a bathroom", "Kileleshwa &middot; 4 km", "KES 7,000", "Ann M.", "High", "This week"))
    + cols(job_tile("Paint two bedrooms", "Lavington &middot; 6 km", "KES 12,000", "Grace N.", "High", "Next week"),
           job_tile("Unblock a drain", "Kilimani &middot; 1 km", "KES 2,000", "Kevin O.", "Low", "Today"),
           job_tile("Fix a door lock", "Hurlingham &middot; 3 km", "KES 1,500", "Lucy A.", "Medium", "Tomorrow")), h=720))

add("withdraw", "Withdraw to M-Pesa", frame("Worker", "Wallet",
    head("Withdraw to M-Pesa", "Send your earnings to your phone"),
    cols(card('<div class="label">Money you can withdraw</div><div class="money" style="font-size:40px">KES 8,200</div>'
              '<div class="small">KES 6,000 more is held safely for your current job</div>'
              '<div style="height:18px"></div>'
              + cols(field("Amount", "8,200"), field("Currency", "KES", select=True))
              + '<div style="height:14px"></div>' + field("M-Pesa phone number", "0722 111 222")
              + PUSH + btn("Withdraw KES 8,200", "primary", "phone", "margin-top:18px"), 3),
         card('<div class="label">Recent withdrawals</div>' + "".join(
              f'<div class="row" style="padding:12px 0;{"border-top:1px solid var(--line)" if i else ""}">'
              f'<div><div style="font-size:15px;font-weight:bold">{a}</div><div class="small">{d}</div></div>{chip("Sent")}</div>'
              for i, (a, d) in enumerate([("KES 5,000", "8 Jun"), ("KES 12,500", "30 May"), ("KES 3,000", "21 May")]))
              + PUSH + '<div class="small" style="margin-top:12px">Money usually arrives in your M-Pesa within a few minutes.</div>', 2)), h=620))

add("worker_trust", "Worker Trust Level", trust_page("Worker",
    "Clients see this when you apply for a job",
    "Worked out from your past jobs, not from reviews alone.",
    ["Finish every job you accept", "Reply to clients quickly",
     "Mark work as done only when it is finished", "Solve problems with clients before they become disputes"],
    [("Jobs completed", "18", "out of 19 accepted"), ("Completion rate", "95%", "jobs finished"),
     ("Disputes", "0", "in the last 6 months"), ("Reply time", "~1 hr", "average")]))

add("transaction_history", "Transaction History", frame("Worker", "History",
    head("History", "All money in and out of your wallet"),
    '<div style="display:flex;gap:8px">' + "".join(
        chip(c, "dark" if i == 0 else "grey") for i, c in enumerate(["All", "Money in", "Money out", "Held"])) + '</div>'
    + card(table(["Date", "What happened", "Job", "Amount", "Status"], [
        ["14 Jun", "Payment held for you", "Paint front gate", '<span class="neg">KES 6,000</span>', chip("Held", "amber")],
        ["8 Jun", "Withdrawal to M-Pesa", "&mdash;", '<span class="neg">&minus; KES 5,000</span>', chip("Sent")],
        ["6 Jun", "Payment released to you", "Fix a door lock", '<span class="pos">+ KES 1,500</span>', chip("Received")],
        ["2 Jun", "Payment released to you", "Unblock a drain", '<span class="pos">+ KES 2,000</span>', chip("Received")],
        ["30 May", "Withdrawal to M-Pesa", "&mdash;", '<span class="neg">&minus; KES 12,500</span>', chip("Sent")],
        ["28 May", "Payment refunded to client", "Gate repair", '<span class="neg">KES 4,000</span>', chip("Refunded", "red")],
    ]), flex="none", extra="padding:6px 12px")))

# ================================================================ ADMIN
def kpi(l, v, s, color=""):
    c = f"color:{color}" if color else ""
    return card(f'<div class="label">{l}</div><div class="money" style="font-size:30px;{c}">{v}</div><div class="small">{s}</div>')

def dispute_row(job, amt, who, why, days):
    return (f'<div class="row" style="padding:12px 0;border-top:1px solid var(--line)">'
            f'<div><div class="title">{job} &middot; {amt}</div><div class="small" style="margin-top:3px">{who}</div>'
            f'<div class="small">&ldquo;{why}&rdquo;</div></div>'
            f'<div style="display:flex;gap:10px;align-items:center">{chip(days, "amber")}{btn("Review", "sm primary", extra="width:110px")}</div></div>')

add("admin_dashboard", "Admin Dashboard", frame("Admin", "Overview",
    head("Overview", "Today, 15 Jun"),
    cols(kpi("Money in escrow", "KES 418,000", "across 58 jobs"),
         kpi("Open disputes", "3", "need your decision", "var(--red)"),
         kpi("Payments today", "124", "2 failed", ""),
         kpi("Active users", "284", "clients and workers"))
    + cols(card('<div class="label">Disputes needing action</div>'
                + dispute_row("Plumbing repair", "KES 12,000", "Mary W. (client) vs Peter N. (worker)", "The leak came back after one day", "2 days")
                + dispute_row("House painting", "KES 20,000", "John K. (client) vs Grace A. (worker)", "Only half the rooms were painted", "1 day")
                + dispute_row("Tiling", "KES 8,500", "Ann M. (client) vs Tom O. (worker)", "Worker did not come", "Today"), 3),
           card('<div class="label">Low-trust users to watch</div>' + "".join(
                f'<div class="row" style="padding:11px 0;{"border-top:1px solid var(--line)" if i else ""}">'
                f'<div><div style="font-size:15px;font-weight:bold">{n}</div><div class="small">{r}</div></div>{trust("Low")}</div>'
                for i, (n, r) in enumerate([("James Mwangi", "Worker &middot; 2 disputes"), ("Kevin Ochieng", "Client &middot; 3 refunds"),
                                            ("Lucy Akinyi", "Worker &middot; 2 unfinished jobs")]))
                + PUSH + '<div class="small" style="margin-top:8px">Scores from the trust model, updated after every job.</div>', 2)), h=620))

add("resolve_dispute", "Resolve Dispute", frame("Admin", "Disputes",
    head("Dispute: Plumbing repair", "Opened 13 Jun &middot; KES 12,000 held in escrow"),
    cols(card('<div class="row"><div class="label">Client says</div>'
              '<div class="row" style="gap:8px"><span class="small">Mary W.</span>' + trust("High") + '</div></div>'
              '<div style="font-size:15px;margin-top:8px;line-height:1.45">&ldquo;The leak came back after one day. I had to call someone else.&rdquo;</div>'
              '<div style="display:flex;gap:10px;margin-top:12px">'
              + '<div class="ph-img" style="width:110px;height:76px">Photo</div>' * 2 + '</div>'
              '<div style="border-top:1px solid var(--line);margin:16px 0 0;padding-top:14px" class="row">'
              '<div class="label">Worker says</div><div class="row" style="gap:8px"><span class="small">Peter N.</span>' + trust("Medium") + '</div></div>'
              '<div style="font-size:15px;margin-top:8px;line-height:1.45">&ldquo;I fixed the pipe. The new leak is from a different pipe.&rdquo;</div>'
              '<div style="display:flex;gap:10px;margin-top:12px"><div class="ph-img" style="width:110px;height:76px">Photo</div></div>', 3),
         card('<div class="label">Your decision</div>'
              '<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">'
              + option("Refund the client (KES 12,000)", True) + option("Pay the worker (KES 12,000)")
              + option("Split: part to each") + '</div>'
              '<div style="height:14px"></div>' + field("Reason (both people will see this)", "The job was not fixed properly.", tall=True)
              + PUSH + btn("Confirm decision", "primary", "check", "margin-top:16px"), 2)), h=600))

add("manage_users", "Manage Users", frame("Admin", "Users",
    head("Users", "284 active &middot; 3 suspended"),
    cols(f'<div class="input ph" style="flex:1"><span style="display:flex;gap:8px;align-items:center">{I["search"]}Search by name or phone</span></div>',
         '<div style="display:flex;gap:8px;align-items:center">' + "".join(
             chip(c, "dark" if i == 0 else "grey") for i, c in enumerate(["All", "Clients", "Workers", "Low trust"])) + '</div>', align="center")
    + card(table(["Name", "Role", "Phone", "Trust level", "Jobs", "Status", ""], [
        ["Peter Njoroge", "Worker", "0712 345 678", trust("High"), "18", chip("Active"), btn("View", "sm", extra="width:80px;height:36px")],
        ["Mary Wanjiru", "Client", "0722 998 120", trust("High"), "9", chip("Active"), btn("View", "sm", extra="width:80px;height:36px")],
        ["Tom Otieno", "Worker", "0701 554 330", trust("Medium"), "5", chip("Active"), btn("View", "sm", extra="width:80px;height:36px")],
        ["James Mwangi", "Worker", "0733 210 876", trust("Low"), "1", chip("Active"), btn("Suspend", "sm danger", extra="width:100px;height:36px")],
        ["Kevin Ochieng", "Client", "0745 667 001", trust("Low"), "4", chip("Suspended", "red"), btn("Restore", "sm", extra="width:100px;height:36px")],
    ]), flex="none", extra="padding:6px 12px"), h=600))

add("payments", "Payments", frame("Admin", "Payments",
    head("Payments", "All M-Pesa and escrow activity"),
    cols(kpi("Held in escrow", "KES 418,000", "58 jobs"), kpi("Released today", "KES 96,500", "31 payments"),
         kpi("Refunded today", "KES 12,000", "2 refunds"), kpi("Failed", "2", "M-Pesa did not confirm", "var(--red)"))
    + card(table(["Time", "M-Pesa ref", "Type", "Who", "Amount", "Status"], [
        ["10:42", "QFK7H2L9P1", "Escrow payment", "Mary W. &rarr; escrow", "KES 3,500", chip("Held", "amber")],
        ["10:31", "QFK6G8M2T4", "Release", "escrow &rarr; Evans O.", "KES 6,000", chip("Done")],
        ["10:05", "QFK5D1R7Y3", "Withdrawal", "Peter N. &rarr; M-Pesa", "KES 5,000", chip("Done")],
        ["09:58", "&mdash;", "Escrow payment", "John K. &rarr; escrow", "KES 20,000", chip("Failed", "red")],
        ["09:40", "QFK4A9C6W8", "Refund", "escrow &rarr; Ann M.", "KES 8,500", chip("Done")],
    ]), flex="none", extra="padding:6px 12px"), h=620))

PAGES = [(f"{i:02d}_{n}", t, html, h) for i, (n, t, html, h) in enumerate(PAGES, 1)]
for name, title, html, h in PAGES:
    open(f"{name}.html", "w", encoding="utf-8").write(page(html, title))
import re
# Render height comes from the page's own outer frame, so screenshots never crop it.
open("sizes.txt", "w", newline="\n").write(
    "\n".join(f"{n} {re.search(r'height:(\d+)px', html).group(1)}" for n, _, html, _ in PAGES) + "\n")
print(len(PAGES), "pages built")
