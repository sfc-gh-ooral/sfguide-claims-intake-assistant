"""Seeded, deterministic generator for the Claims Intake and Triage Assistant example.

Writes synthetic tables to data/csv/, one document per file to data/documents/ (PDF
forms, emails, estimates, police and medical summaries, plus a few drawn damage
illustrations as PNG), and the same records to lib/mock/base.json for no-account mode.
Every name, number and document is invented. Run: python3 scripts/generate_data.py
Requires: reportlab, Pillow.
"""
import csv
import json
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
CSV_DIR, DOC_DIR, MOCK = ROOT / "data/csv", ROOT / "data/documents", ROOT / "lib/mock"
for d in (CSV_DIR, DOC_DIR, MOCK):
    d.mkdir(parents=True, exist_ok=True)

rng = random.Random(20261118)
AS_OF = date(2026, 11, 18)
CARRIER = "Veltrona Mutual Insurance"

FIRST = ["Avery", "Jordan", "Priya", "Mateo", "Elena", "Marcus", "Hana", "Diego", "Grace", "Omar", "Lena", "Caleb",
         "Sofia", "Andre", "Maya", "Felix", "Nadia", "Theo", "Rosa", "Isaac", "Leah", "Victor", "Imani", "Owen",
         "Clara", "Rahul", "Tessa", "Julian", "Amara", "Wes", "Nora", "Kofi", "Ines", "Ruben", "Mira", "Simon"]
LAST = ["Halvorsen", "Okafor", "Brennan", "Castillo", "Nakamura", "Whitcomb", "Delacroix", "Petrov", "Sandoval",
        "Ashworth", "Kowalczyk", "Moreau", "Lindqvist", "Abernathy", "Quintero", "Vasquez", "Thorne", "Iyer",
        "Galloway", "Fairbanks", "Mbeki", "Rasmussen", "Calloway", "Ortega", "Haverford", "Sato", "Marchetti"]
CITIES = [("Brookhaven", "OH"), ("Millbrook", "OH"), ("Cedar Falls", "OH"), ("Ashford", "OH"), ("Lakemont", "OH"),
          ("Riverton", "OH"), ("Fairview Heights", "OH")]
STREETS = ["Maple Ave", "Oak St", "Route 9", "Elm Dr", "Harbor Rd", "Lincoln Blvd", "Pine Ridge Rd", "Main St",
           "Willow Ln", "County Rd 12", "Kingsley Pkwy", "Station St"]
VEHICLES = [("2021", "Toyota", "Camry"), ("2019", "Honda", "CR-V"), ("2022", "Ford", "F-150"), ("2020", "Subaru", "Outback"),
            ("2018", "Chevrolet", "Malibu"), ("2023", "Hyundai", "Tucson"), ("2017", "Nissan", "Altima"),
            ("2021", "Kia", "Sorento"), ("2020", "Mazda", "CX-5"), ("2022", "Jeep", "Grand Cherokee")]
SHOPS = ["Ardenvale Auto Body", "Kestrel Collision Center", "Brightmere Glass & Auto", "Oakhollow Body Works",
         "Tamsin Ridge Collision"]
CLINICS = ["Lakemont Regional Medical Center", "Cedar Falls Orthopedic Group", "Brookhaven Imaging Associates",
           "Riverton Physical Therapy"]
PD = ["Brookhaven Police Department", "Millbrook Police Department", "Ashford County Sheriff's Office",
      "Lakemont Police Department"]


def name():
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def d(x):
    return x.isoformat()


def usd(x):
    return f"${x:,.2f}"


# --------------------------------------------------------------------------- adjusters
ADJUSTERS = [
    ("ADJ01", "Renata Okonkwo", "Fast track; glass; comprehensive", 40, 24),
    ("ADJ02", "Dylan Achterberg", "Fast track; collision property damage", 40, 31),
    ("ADJ03", "Mei-Lin Carver", "Collision property damage; total loss", 30, 22),
    ("ADJ04", "Thomas Quill", "Collision property damage; rental", 30, 27),
    ("ADJ05", "Alisha Brandt", "Bodily injury; medical review", 22, 19),
    ("ADJ06", "Gabriel Ferreira", "Bodily injury; litigation", 20, 12),
    ("ADJ07", "Priya Ramaswamy", "Special investigations (SIU)", 15, 9),
    ("ADJ08", "Colin Mbatha", "Complex property damage; theft", 25, 14),
]
TIER_ADJ = {"Fast track": ["ADJ01", "ADJ02"], "Standard": ["ADJ03", "ADJ04", "ADJ08"],
            "Complex": ["ADJ05", "ADJ06", "ADJ08"], "SIU referral": ["ADJ07"]}

# --------------------------------------------------------------------------- policies + claims
LOSS_TYPES = [("Collision", 46), ("Glass", 18), ("Comprehensive - hail", 8), ("Comprehensive - animal", 7),
              ("Theft", 5), ("Collision with injury", 12)]


def pick_type():
    t = rng.uniform(0, sum(w for _, w in LOSS_TYPES))
    for k, w in LOSS_TYPES:
        t -= w
        if t <= 0:
            return k
    return LOSS_TYPES[0][0]


policies, claims, documents, notes, loss_history = [], [], [], [], []
doc_seq = [0]


def new_policy(pid, insured, inception=None):
    inception = inception or (AS_OF - timedelta(days=rng.randint(60, 340)))
    city, st = rng.choice(CITIES)
    yr, mk, md = rng.choice(VEHICLES)
    p = dict(policy_number=pid, insured_name=insured, product="Personal Auto", state=st,
             address=f"{rng.randint(12, 9800)} {rng.choice(STREETS)}, {city}, {st}",
             inception_date=d(inception), expiration_date=d(inception + timedelta(days=365)),
             vehicle=f"{yr} {mk} {md}", vin=f"{rng.choice('13JK5')}{''.join(rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ0123456789') for _ in range(16))}",
             collision_deductible=rng.choice([500, 500, 1000, 250]), comprehensive_deductible=rng.choice([250, 500, 500]),
             full_glass=rng.random() < 0.55, bi_limit_per_person=rng.choice([50000, 100000, 100000, 250000]),
             bi_limit_per_accident=0, pd_limit=rng.choice([50000, 100000]), med_pay_limit=rng.choice([5000, 5000, 10000]),
             rental_per_day=rng.choice([0, 30, 40]))
    p["bi_limit_per_accident"] = p["bi_limit_per_person"] * 2 if p["bi_limit_per_person"] < 250000 else 500000
    policies.append(p)
    return p


def add_doc(claim, dtype, received, fmt="pdf", **content):
    doc_seq[0] += 1
    doc_id = f"DOC-{doc_seq[0]:04d}"
    fname = f"{doc_id}-{dtype.replace('_', '-')}.{fmt}"
    rec = dict(doc_id=doc_id, claim_id=claim["claim_id"], doc_type=dtype, file_name=fname,
               received_at=received.isoformat(timespec="minutes"), source=content.pop("source", "Email"))
    rec["_content"] = content
    documents.append(rec)
    return rec


def received_ts(day, early=False):
    return datetime(day.year, day.month, day.day, rng.randint(7, 11 if early else 18), rng.choice([2, 14, 27, 41, 53]))


STORY = {}
claim_no = [24000]


def make_claim(loss_type, policy=None, loss_date=None, reported=None, story=None, injury=None):
    claim_no[0] += rng.randint(1, 3)
    cid = f"CLM-{claim_no[0]}"
    insured = policy["insured_name"] if policy else name()
    policy = policy or new_policy(f"PA-{rng.randint(4100000, 4899999)}", insured)
    reported = reported or (AS_OF - timedelta(days=rng.randint(0, 27)))
    loss_date = loss_date or (reported - timedelta(days=rng.choice([0, 0, 1, 1, 1, 2, 3, 5])))
    city, st = policy["address"].split(", ")[1], policy["state"]
    c = dict(claim_id=cid, policy_number=policy["policy_number"], insured_name=insured, loss_type=loss_type,
             loss_date=d(loss_date), reported_date=d(reported), loss_city=city, loss_state=st,
             loss_location=f"{rng.choice(STREETS)} near {rng.choice(STREETS)}, {city}, {st}",
             vehicle=policy["vehicle"], status="New" if (AS_OF - reported).days <= 6 else "In progress",
             assigned_adjuster="", story=story or "")
    claims.append(c)
    if story:
        STORY[story] = cid
    return c, policy


def fnol(c, p, desc, injuries="No injuries reported.", police="", phone=None):
    rec = received_ts(date.fromisoformat(c["reported_date"]))
    add_doc(c, "fnol_email", rec, source="Email",
            sender=f"{c['insured_name'].split()[0].lower()}.{c['insured_name'].split()[1].lower()}@example.com",
            subject=f"New claim - policy {p['policy_number']} - {c['loss_type'].split(' -')[0].lower()} on {c['loss_date']}",
            body=[f"Hello, I need to report a claim on my auto policy {p['policy_number']}.",
                  f"Date of loss: {c['loss_date']}. Location: {c['loss_location']}.",
                  f"Vehicle: {c['vehicle']} (VIN {p['vin']}).", desc, injuries]
                 + ([f"Police report number: {police}."] if police else [])
                 + [f"You can reach me at {phone or f'(555) 01{rng.randint(10, 99)}-{rng.randint(1000, 9999)}'}.",
                    f"Thank you, {c['insured_name']}"])
    return rec


def claim_form(c, p, desc, injuries="None", police="None", day_offset=1):
    rec = received_ts(date.fromisoformat(c["reported_date"]) + timedelta(days=day_offset))
    add_doc(c, "claim_form", rec, source="Portal upload",
            fields=[("Policy number", p["policy_number"]), ("Named insured", c["insured_name"]),
                    ("Date of loss", c["loss_date"]), ("Time of loss", f"{rng.randint(6, 21)}:{rng.choice(['05', '20', '35', '50'])}"),
                    ("Loss location", c["loss_location"]), ("Vehicle", c["vehicle"]), ("VIN", p["vin"]),
                    ("Driver", c["insured_name"]), ("Description of loss", desc), ("Injuries", injuries),
                    ("Police report number", police), ("Other party", c.get("_other", "None"))])


def estimate(c, p, lines, shop=None, total=None, day_offset=2):
    rec = received_ts(date.fromisoformat(c["reported_date"]) + timedelta(days=day_offset))
    line_sum = round(sum(q * u for _, q, u in lines), 2)
    add_doc(c, "repair_estimate", rec, source="Shop upload", shop=shop or rng.choice(SHOPS), vehicle=c["vehicle"],
            vin=p["vin"], estimate_no=f"E-{rng.randint(30000, 89999)}", lines=lines, line_sum=line_sum,
            total=total if total is not None else line_sum)
    return line_sum


def police(c, report_no, narrative, at_fault, injuries, day_offset=2, dept=None):
    rec = received_ts(date.fromisoformat(c["reported_date"]) + timedelta(days=day_offset))
    add_doc(c, "police_report", rec, source="Agency portal", dept=dept or rng.choice(PD), report_no=report_no,
            date=c["loss_date"], location=c["loss_location"], narrative=narrative, at_fault=at_fault, injuries=injuries)


def medical(c, provider, svc_date, patient, items, dx, day):
    add_doc(c, "medical_bill", received_ts(day), source="Provider fax", provider=provider, service_date=d(svc_date),
            patient=patient, items=items, total=round(sum(a for _, a in items), 2), dx=dx)


def photo(c, kind, day):
    add_doc(c, "damage_photo", received_ts(day), fmt="png", source="Mobile app", kind=kind)


def note(c, author, when, text):
    notes.append(dict(note_id=f"N-{len(notes) + 1:04d}", claim_id=c["claim_id"], author=author,
                      created_at=when.isoformat(timespec="minutes"), note_text=text))


def collision_lines(sev):
    base = [("Front bumper cover - replace", 1, rng.choice([465.0, 512.0, 588.0])),
            ("Bumper refinish (paint labor)", rng.choice([2.5, 3.0, 3.5]), 62.0),
            ("Headlamp assembly - left", 1, rng.choice([389.0, 446.0, 512.0])),
            ("Body labor", rng.choice([4.0, 5.5, 6.0, 7.5]), 64.0),
            ("Paint materials", 1, rng.choice([148.0, 176.0, 212.0]))]
    if sev > 1:
        base += [("Hood panel - replace", 1, rng.choice([620.0, 735.0])), ("Radiator support - repair", 1, 340.0),
                 ("Frame labor", rng.choice([3.0, 4.0]), 82.0)]
    if sev > 2:
        base += [("Left fender - replace", 1, 410.0), ("Airbag module - front", 1, 1180.0),
                 ("Wheel alignment", 1, 129.0)]
    return base


# ---- Story 1: SIU referral. Reported 2 days after policy inception, with a prior-loss pattern.
p1 = new_policy("PA-4719326", "Desmond Varga", inception=date(2026, 11, 10))
c1, _ = make_claim("Theft", p1, loss_date=date(2026, 11, 12), reported=date(2026, 11, 12), story="siu")
fnol(c1, p1, "I parked overnight on the street and in the morning the car was gone. Aftermarket wheels and a new audio "
             "system had just been installed. Please process this quickly, I need the payout to replace the car.",
     police="MPD-26-118842")
claim_form(c1, p1, "Vehicle stolen from street parking overnight; keys are in my possession.", police="MPD-26-118842")
police(c1, "MPD-26-118842", "Reporting party states vehicle was taken from street parking overnight. Report filed "
       "three days after the reported loss. No witnesses. No signs of broken glass found at the location.",
       "Unknown", "None", day_offset=3, dept="Millbrook Police Department")
for i, (yr, carrier, kind, amt) in enumerate([(2024, "Prior carrier A", "Theft", 18400), (2025, "Prior carrier B",
                                               "Collision", 9650), (2025, "Prior carrier C", "Theft", 21200)]):
    loss_history.append(dict(policy_number=p1["policy_number"], insured_name=p1["insured_name"],
                             loss_date=d(date(yr, [3, 2, 9][i], [14, 22, 5][i])), prior_carrier=carrier,
                             loss_type=kind, paid_amount=amt))
note(c1, "Intake", datetime(2026, 11, 13, 9, 12), "Loss-history report returned 3 prior losses in 32 months "
     "(2 thefts, 1 collision) with three different carriers. Policy bound 2026-11-10.")
note(c1, "Intake", datetime(2026, 11, 14, 15, 40), "Insured called twice asking for payout timing. Says title is at home.")

# ---- Story 2: low-complexity glass claim suited to fast track.
p2 = new_policy("PA-4382015", "Hana Lindqvist", inception=date(2025, 6, 2))
p2["full_glass"] = True
c2, _ = make_claim("Glass", p2, loss_date=date(2026, 11, 16), reported=date(2026, 11, 16), story="glass")
fnol(c2, p2, "A rock from a gravel truck hit my windshield on the highway. There is a crack about 10 inches long "
             "on the passenger side. The car is drivable.")
estimate(c2, p2, [("Windshield glass - replace (OEM equivalent)", 1, 312.0), ("Moulding kit", 1, 38.0),
                  ("Glass labor", 1.0, 62.0)], shop="Brightmere Glass & Auto", day_offset=1)
photo(c2, "windshield", datetime(2026, 11, 16, 14, 5))
note(c2, "Intake", datetime(2026, 11, 16, 15, 2), "Insured prefers mobile glass service at work address.")

# ---- Story 3: bodily injury with escalating medical bills.
p3 = new_policy("PA-4561187", "Marisol Quintero", inception=date(2025, 9, 18))
c3, _ = make_claim("Collision with injury", p3, loss_date=date(2026, 10, 24), reported=date(2026, 10, 24), story="bi")
c3["_other"] = "Grant Ashworth, 2018 Chevrolet Malibu"
fnol(c3, p3, "I was stopped at a red light when another car hit me from behind. My passenger, my sister Lucia "
             "Quintero, hurt her neck and back and was taken to the hospital by ambulance.",
     injuries="Passenger Lucia Quintero was injured and transported to Lakemont Regional Medical Center.",
     police="LPD-26-40217")
claim_form(c3, p3, "Rear-ended while stopped at a red light by other driver.", injuries="Passenger: neck and lower back pain",
           police="LPD-26-40217")
police(c3, "LPD-26-40217", "Unit 2 failed to stop and struck Unit 1 from behind at the signal. Passenger in Unit 1 "
       "complained of neck pain and was transported by EMS.", "Other driver (Unit 2)", "Passenger, possible injury",
       dept="Lakemont Police Department")
estimate(c3, p3, [("Rear bumper cover - replace", 1, 548.0), ("Rear body panel - repair", 1, 420.0),
                  ("Trunk lid - replace", 1, 690.0), ("Body labor", 9.0, 64.0), ("Refinish labor", 5.0, 62.0),
                  ("Paint materials", 1, 236.0)], shop="Kestrel Collision Center")
bills = [(date(2026, 10, 24), "Lakemont Regional Medical Center", [("Emergency department visit, level 3", 890.0),
          ("Cervical spine X-ray", 350.0)], "Cervical strain"),
         (date(2026, 11, 3), "Brookhaven Imaging Associates", [("MRI cervical spine without contrast", 2480.0),
          ("MRI lumbar spine without contrast", 1380.0)], "Cervical strain; lumbar radiculopathy"),
         (date(2026, 11, 10), "Riverton Physical Therapy", [("Physical therapy evaluation", 420.0),
          ("Physical therapy sessions (12)", 4680.0), ("Orthopedic consult", 2850.0)], "Lumbar disc herniation L4-L5"),
         (date(2026, 11, 17), "Cedar Falls Orthopedic Group", [("Epidural steroid injection", 3900.0),
          ("Surgical consultation and pre-op workup", 10400.0)], "Lumbar disc herniation L4-L5; surgical candidate")]
for svc, prov, items, dx in bills:
    medical(c3, prov, svc, "Lucia Quintero", items, dx, svc + timedelta(days=2))
note(c3, "Intake", datetime(2026, 10, 25, 10, 5), "Liability looks clear (rear-end). Passenger injury reported; "
     "med pay limit $5,000 on our policy, other carrier BI claim to be opened.")
note(c3, "Alisha Brandt", datetime(2026, 11, 12, 16, 30), "PT bill received. Passenger now represented? Not confirmed.")
note(c3, "Alisha Brandt", datetime(2026, 11, 18, 9, 45), "Surgical consult bill received. Medical specials trending up "
     "fast; consider reserve review.")

# ---- Story 4: estimate whose total doesn't match its line items.
p4 = new_policy("PA-4290654", "Bram Kowalczyk", inception=date(2025, 3, 11))
c4, _ = make_claim("Collision", p4, loss_date=date(2026, 11, 14), reported=date(2026, 11, 15), story="estimate")
fnol(c4, p4, "I slid on wet leaves and hit a guardrail with the front of my car. Front end damage, the hood is bent.")
claim_form(c4, p4, "Single-vehicle collision with guardrail on wet road.")
lines4 = [("Front bumper cover - replace", 1, 588.0), ("Hood panel - replace", 1, 735.0),
          ("Headlamp assembly - left", 1, 512.0), ("Radiator support - repair", 1, 340.0), ("Body labor", 12.0, 64.0),
          ("Refinish labor", 8.0, 62.0), ("Paint materials", 1, 212.0), ("Frame labor", 4.0, 82.0)]
estimate(c4, p4, lines4, shop="Oakhollow Body Works", total=round(sum(q * u for _, q, u in lines4), 2) + 1250.0)
photo(c4, "front", datetime(2026, 11, 15, 12, 40))

# ---- Everyone else
while len(documents) < 314:
    lt = pick_type()
    c, p = make_claim(lt)
    rd = date.fromisoformat(c["reported_date"])
    yr, mk, md = c["vehicle"].split(" ", 2)
    if lt == "Glass":
        fnol(c, p, rng.choice(["A stone chipped my windshield and the chip has spread into a crack.",
                               "My windshield cracked overnight during the cold snap, about 8 inches from the edge.",
                               "Rear window was shattered in a parking lot, nothing taken from the car."]))
        estimate(c, p, [("Windshield glass - replace", 1, rng.choice([289.0, 334.0, 365.0])),
                        ("Glass labor", 1.0, rng.choice([55.0, 62.0])), ("Moulding kit", 1, 38.0)],
                 shop="Brightmere Glass & Auto", day_offset=1)
    elif lt.startswith("Comprehensive"):
        desc = ("Hail storm left dents across the roof, hood and trunk lid." if "hail" in lt
                else "A deer ran into the road and I hit it. Damage to the front bumper and grille.")
        fnol(c, p, desc)
        if rng.random() < 0.6:
            claim_form(c, p, desc)
        sev = rng.choice([1, 1, 2])
        estimate(c, p, collision_lines(sev) if "animal" in lt else
                 [("Paintless dent repair - roof", 1, rng.choice([980.0, 1240.0])),
                  ("Paintless dent repair - hood", 1, rng.choice([420.0, 560.0])),
                  ("Paintless dent repair - trunk lid", 1, 310.0), ("R&I headliner", 1, 180.0)])
    elif lt == "Theft":
        pr = f"{rng.choice(['BPD', 'APD', 'ACSO'])}-26-{rng.randint(100000, 999999)}"
        fnol(c, p, rng.choice(["My catalytic converter was cut out overnight in the driveway.",
                               "Someone broke the passenger window and stole a laptop bag and the stereo."]), police=pr)
        claim_form(c, p, "Theft from vehicle, reported to police.", police=pr)
        police(c, pr, "Reporting party discovered damage in the morning. Patrol confirmed forced entry/cut marks.",
               "Unknown", "None")
        estimate(c, p, [("Catalytic converter - replace", 1, rng.choice([1450.0, 1890.0])), ("Exhaust labor", 2.0, 95.0),
                        ("O2 sensor", 1, 165.0)])
    else:
        injured = lt == "Collision with injury"
        sev = rng.choice([1, 1, 2, 2, 3]) if not injured else rng.choice([2, 3])
        other = name()
        c["_other"] = f"{other}, {' '.join(rng.choice(VEHICLES))}"
        desc = rng.choice(["Another driver backed into my car in a parking lot.",
                           "I was making a left turn and the other car ran the yellow and hit my front corner.",
                           "Car in front stopped suddenly and I could not stop in time.",
                           "Other driver sideswiped me while merging onto the highway."])
        pr = f"{rng.choice(['BPD', 'MPD', 'LPD'])}-26-{rng.randint(10000, 99999)}" if (injured or rng.random() < 0.35) else ""
        inj = "My passenger has neck pain and went to urgent care." if injured else "No injuries reported."
        fnol(c, p, desc, injuries=inj, police=pr)
        if rng.random() < 0.65:
            claim_form(c, p, desc, injuries="Passenger neck pain" if injured else "None", police=pr or "None")
        estimate(c, p, collision_lines(sev))
        if pr:
            police(c, pr, f"Units collided at the location. {desc}", rng.choice(["Unit 1", "Unit 2 (other driver)"]),
                   "Passenger, possible injury" if injured else "None")
        if injured:
            pt = name()
            medical(c, rng.choice(CLINICS), rd + timedelta(days=1), pt,
                    [("Urgent care visit", rng.choice([240.0, 310.0])), ("Cervical spine X-ray", 350.0)], "Cervical strain",
                    rd + timedelta(days=3))
            if rng.random() < 0.5:
                medical(c, "Riverton Physical Therapy", rd + timedelta(days=8), pt,
                        [("Physical therapy sessions (4)", 1560.0)], "Cervical strain", rd + timedelta(days=10))
        if sev >= 2 and sum(1 for x in documents if x["doc_type"] == "damage_photo") < 7:
            photo(c, rng.choice(["front", "side"]), datetime(rd.year, rd.month, rd.day, 13, 10))

# Drop future-dated documents (received after the as-of date) so the inbox is consistent.
cutoff = datetime(AS_OF.year, AS_OF.month, AS_OF.day, 23, 59)
documents = [x for x in documents if datetime.fromisoformat(x["received_at"]) <= cutoff]

# Routing for claims already in progress, and short notes
by_tier_default = {"Glass": "Fast track", "Comprehensive - hail": "Standard", "Comprehensive - animal": "Standard",
                   "Theft": "Standard", "Collision": "Standard", "Collision with injury": "Complex"}
for c in claims:
    if c["status"] == "In progress":
        tier = by_tier_default[c["loss_type"]] if not c["story"] else {"bi": "Complex"}.get(c["story"], "Standard")
        c["assigned_adjuster"] = rng.choice(TIER_ADJ[tier])
        if c["story"] == "bi":
            c["assigned_adjuster"] = "ADJ05"
        if not c["story"]:
            note(c, dict((a[0], a[1]) for a in ADJUSTERS)[c["assigned_adjuster"]],
                 datetime.fromisoformat(c["reported_date"] + "T10:00") + timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 6)),
                 rng.choice(["Contacted insured, rental arranged.", "Inspection scheduled at shop.",
                             "Recorded statement taken; facts consistent with FNOL.", "Awaiting supplement from shop."]))
    elif not c["story"] and rng.random() < 0.4:
        note(c, "Intake", datetime.fromisoformat(c["reported_date"] + "T16:20"),
             rng.choice(["Insured asked about rental coverage.", "Insured uploaded documents through the portal.",
                         "Voicemail left for insured to confirm loss location."]))

# Closed-claim history for the cycle-time trend (12 months, by tier)
closed = []
for m in range(12):
    month = date(2025, 12, 1) + timedelta(days=31 * m)
    month = date(month.year, month.month, 1)
    for tier, n, mu in [("Fast track", 22, 6.5), ("Standard", 30, 19), ("Complex", 9, 48), ("SIU referral", 2, 75)]:
        drift = {"Fast track": -0.12, "Standard": -0.35, "Complex": 0.6, "SIU referral": 0.0}[tier] * m
        for i in range(n + rng.randint(-3, 3)):
            rep = month + timedelta(days=rng.randint(0, 27))
            days = max(1, int(rng.gauss(mu + drift, mu * 0.25)))
            closed.append(dict(claim_id=f"H-{len(closed) + 1:05d}", tier=tier, reported_date=d(rep),
                               closed_date=d(rep + timedelta(days=days))))
closed = [x for x in closed if x["closed_date"] <= d(AS_OF)]

# --------------------------------------------------------------------------- render documents
W, H = LETTER


def pdf_header(cv, title, org, sub=""):
    cv.setFillColorRGB(0.07, 0.18, 0.32)
    cv.rect(0, H - 74, W, 74, fill=1, stroke=0)
    cv.setFillColorRGB(1, 1, 1)
    cv.setFont("Helvetica-Bold", 15)
    cv.drawString(48, H - 40, org)
    cv.setFont("Helvetica", 10)
    cv.drawString(48, H - 58, sub)
    cv.setFillColorRGB(0, 0, 0)
    cv.setFont("Helvetica-Bold", 13)
    cv.drawString(48, H - 104, title)
    cv.setFont("Helvetica", 7)
    cv.setFillColorRGB(0.45, 0.45, 0.45)
    cv.drawString(48, 30, "SYNTHETIC DOCUMENT - generated for a Snowflake example. All names, numbers and organizations are fictional.")
    cv.setFillColorRGB(0, 0, 0)


def wrap(text, width=92):
    out, line = [], ""
    for w in text.split():
        if len(line) + len(w) + 1 > width:
            out.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    return out + ([line] if line else [])


def kv(cv, y, label, value, wl=150):
    cv.setFont("Helvetica-Bold", 10)
    cv.drawString(48, y, f"{label}:")
    cv.setFont("Helvetica", 10)
    lines = wrap(str(value), 70)
    for i, ln in enumerate(lines):
        cv.drawString(48 + wl, y - 14 * i, ln)
    return y - 14 * max(1, len(lines)) - 6


def text_of(doc):
    """Plain-text rendering of the same document, for no-account mode and highlighting."""
    k, t = doc["_content"], doc["doc_type"]
    if t == "fnol_email":
        return "\n".join([f"From: {k['sender']}", f"To: claims@veltrona-mutual.example", f"Date: {doc['received_at'].replace('T', ' ')}",
                          f"Subject: {k['subject']}", ""] + k["body"])
    if t == "claim_form":
        return "\n".join([f"{CARRIER} - Auto Claim Form (Notice of Loss)"] + [f"{a}: {b}" for a, b in k["fields"]])
    if t == "repair_estimate":
        rows = [f"{desc} | qty {q:g} | {usd(u)} | {usd(q * u)}" for desc, q, u in k["lines"]]
        return "\n".join([f"{k['shop']} - Repair Estimate {k['estimate_no']}", f"Vehicle: {k['vehicle']}  VIN: {k['vin']}",
                          "Line items (description | qty/hours | unit | amount):"] + rows + [f"ESTIMATE TOTAL: {usd(k['total'])}"])
    if t == "police_report":
        return "\n".join([f"{k['dept']} - Traffic/Incident Report (excerpt)", f"Report number: {k['report_no']}",
                          f"Incident date: {k['date']}", f"Location: {k['location']}", f"Narrative: {k['narrative']}",
                          f"Party at fault: {k['at_fault']}", f"Injuries: {k['injuries']}"])
    if t == "medical_bill":
        return "\n".join([f"{k['provider']} - Itemized Bill Summary", f"Patient: {k['patient']}",
                          f"Date of service: {k['service_date']}", f"Diagnosis: {k['dx']}"]
                         + [f"{a}: {usd(b)}" for a, b in k["items"]] + [f"TOTAL BILLED: {usd(k['total'])}"])
    return f"Damage photo ({k['kind']}) uploaded through the mobile app."


def render_pdf(doc):
    k, t = doc["_content"], doc["doc_type"]
    cv = canvas.Canvas(str(DOC_DIR / doc["file_name"]), pagesize=LETTER, invariant=1)
    cv.setTitle(f"{doc['doc_id']} {t}")
    y = H - 132
    if t == "fnol_email":
        pdf_header(cv, "Email - first notice of loss", CARRIER, "Claims inbox - printed message")
        for lab, val in [("From", k["sender"]), ("To", "claims@veltrona-mutual.example"),
                         ("Date", doc["received_at"].replace("T", " ")), ("Subject", k["subject"])]:
            y = kv(cv, y, lab, val, 70)
        y -= 8
        cv.setFont("Helvetica", 10.5)
        for para in k["body"]:
            for ln in wrap(para, 95):
                cv.drawString(48, y, ln)
                y -= 15
            y -= 6
    elif t == "claim_form":
        pdf_header(cv, "Auto Claim Form - Notice of Loss", CARRIER, "Form ACF-1 (rev. 2026)")
        for a, b in k["fields"]:
            y = kv(cv, y, a, b)
    elif t == "repair_estimate":
        pdf_header(cv, f"Repair Estimate {k['estimate_no']}", k["shop"], "Licensed collision repair facility")
        y = kv(cv, y, "Vehicle", k["vehicle"])
        y = kv(cv, y, "VIN", k["vin"])
        y -= 6
        cv.setFont("Helvetica-Bold", 9.5)
        for x, h in [(48, "Description"), (350, "Qty/Hrs"), (420, "Unit"), (500, "Amount")]:
            cv.drawString(x, y, h)
        y -= 6
        cv.line(48, y, W - 48, y)
        y -= 14
        cv.setFont("Helvetica", 9.5)
        for desc, q, u in k["lines"]:
            cv.drawString(48, y, desc)
            cv.drawRightString(390, y, f"{q:g}")
            cv.drawRightString(470, y, usd(u))
            cv.drawRightString(W - 48, y, usd(q * u))
            y -= 15
        cv.line(48, y + 6, W - 48, y + 6)
        cv.setFont("Helvetica-Bold", 11)
        cv.drawString(350, y - 10, "ESTIMATE TOTAL")
        cv.drawRightString(W - 48, y - 10, usd(k["total"]))
    elif t == "police_report":
        pdf_header(cv, "Traffic / Incident Report - Excerpt", k["dept"], "Released to insurer on request")
        for a, b in [("Report number", k["report_no"]), ("Incident date", k["date"]), ("Location", k["location"]),
                     ("Narrative", k["narrative"]), ("Party at fault", k["at_fault"]), ("Injuries", k["injuries"])]:
            y = kv(cv, y, a, b)
    elif t == "medical_bill":
        pdf_header(cv, "Itemized Bill Summary", k["provider"], "Patient account statement")
        for a, b in [("Patient", k["patient"]), ("Date of service", k["service_date"]), ("Diagnosis", k["dx"])]:
            y = kv(cv, y, a, b)
        y -= 8
        cv.setFont("Helvetica", 10)
        for a, b in k["items"]:
            cv.drawString(48, y, a)
            cv.drawRightString(W - 48, y, usd(b))
            y -= 15
        cv.line(48, y + 6, W - 48, y + 6)
        cv.setFont("Helvetica-Bold", 11)
        cv.drawString(48, y - 10, "TOTAL BILLED")
        cv.drawRightString(W - 48, y - 10, usd(k["total"]))
    cv.save()


def render_png(doc):
    kind = doc["_content"]["kind"]
    r = random.Random(doc["doc_id"])
    img = Image.new("RGB", (960, 640), (196, 202, 208))
    g = ImageDraw.Draw(img)
    g.rectangle([0, 470, 960, 640], fill=(92, 94, 98))  # pavement
    body = tuple(r.choice([(38, 74, 140), (150, 30, 36), (210, 210, 214), (40, 40, 44)]))
    if kind == "windshield":
        g.polygon([(110, 520), (180, 170), (780, 170), (850, 520)], fill=(30, 34, 40))  # dashboard frame
        g.polygon([(170, 480), (230, 210), (730, 210), (790, 480)], fill=(150, 186, 210))  # glass
        x, y = 600, 300
        for _ in range(9):  # crack
            nx, ny = x + r.randint(-60, 25), y + r.randint(-10, 30)
            g.line([(x, y), (nx, ny)], fill=(250, 250, 250), width=3)
            x, y = nx, ny
        g.ellipse([590, 290, 612, 312], outline=(255, 255, 255), width=3)
    else:
        g.rounded_rectangle([120, 260, 840, 470], 40, fill=body)
        g.polygon([(260, 260), (340, 160), (620, 160), (720, 260)], fill=body)
        g.polygon([(300, 255), (360, 180), (480, 180), (480, 255)], fill=(160, 190, 210))
        g.polygon([(500, 255), (500, 180), (610, 180), (680, 255)], fill=(160, 190, 210))
        for cx in (260, 700):
            g.ellipse([cx - 65, 410, cx + 65, 540], fill=(25, 25, 25))
            g.ellipse([cx - 30, 445, cx + 30, 505], fill=(150, 150, 155))
        zone = (130, 300, 330, 460) if kind == "front" else (380, 300, 620, 450)
        for _ in range(26):  # dents and scrapes
            x0, y0 = r.randint(zone[0], zone[2]), r.randint(zone[1], zone[3])
            g.line([(x0, y0), (x0 + r.randint(-50, 50), y0 + r.randint(-14, 14))], fill=(70, 70, 70), width=r.randint(2, 6))
        g.ellipse([zone[0] + 30, zone[1] + 20, zone[0] + 150, zone[1] + 110], outline=(20, 20, 20), width=5)
    g.text((18, 610), "SYNTHETIC ILLUSTRATION - not a real vehicle", fill=(255, 255, 255))
    img.save(DOC_DIR / doc["file_name"], optimize=True)


for f in DOC_DIR.glob("*"):
    f.unlink()
for doc in documents:
    (render_png if doc["file_name"].endswith(".png") else render_pdf)(doc)
    doc["text"] = text_of(doc)

# --------------------------------------------------------------------------- write tables
adjusters = [dict(adjuster_id=a, name=n, skills=s, capacity=cap, open_claims=o) for a, n, s, cap, o in ADJUSTERS]
for c in claims:
    c.pop("_other", None)
pub_docs = [{k: v for k, v in x.items() if not k.startswith("_") and k != "text"} for x in documents]
tables = dict(policies=policies, adjusters=adjusters, claims=claims, claim_notes=notes, loss_history=loss_history,
              closed_claims=closed, documents=pub_docs)
for tname, rows in tables.items():
    with open(CSV_DIR / f"{tname}.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

base = dict(asOf=d(AS_OF), carrier=CARRIER, stories=STORY,
            policies=policies, adjusters=adjusters, claims=claims, notes=notes, lossHistory=loss_history,
            documents=[{k: v for k, v in x.items() if not k.startswith("_")} for x in documents])
(MOCK / "base.json").write_text(json.dumps(base, indent=1))
print(f"{len(claims)} claims, {len(documents)} documents, {len(notes)} notes, {len(policies)} policies, "
      f"{len(closed)} closed claims. Stories: {STORY}")
