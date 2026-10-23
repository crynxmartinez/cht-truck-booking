# How to swap a booking to the other truck

For when a truck is out of service, or a booking simply needs the other one.
You do this from the CRM. Nothing here needs a developer.

## The 30-second version

1. Open the **Board** or the **Calendar**.
2. Click the booking.
3. Scroll to **Move to the other truck**.
4. Click **Move to Truck B** (or A) and press **OK**.

That's it. The renter is texted and emailed, Diana is alerted, the Google
calendar relabels itself, and the activity log records it.

## When you can and can't swap

| Where the booking is | Can you swap it? |
|---|---|
| Booked, waiting for the renter to sign | Yes |
| Signed, waiting for Diana's counter-signature | Yes |
| Accepted, pickup date still ahead | Yes |
| Pickup is **today**, lockbox code **not** sent yet | Yes |
| Pickup is today, lockbox code **already sent** | **No** — the renter holds the other truck's code |
| Picked up, in use, returned, completed, cancelled | **No** |

The only thing that really matters is the lockbox code. Each truck has its
own, so once a renter has been sent one, moving them would leave them standing
at a lockbox that won't open.

## Before you start

- **The truck you're moving to must be switched on.** Go to **Trucks &
  lockboxes** and set it to **Bookable**. If you're swapping because a truck
  is broken, switch the *new* one on first, move the bookings, and switch the
  *broken* one off last — otherwise a customer on the booking site can be
  handed the truck that's out.
- **It must be free on those days.** The screen tells you. If the other truck
  is already booked, the button is greyed out and says who has it.

## If you can't see "Move to the other truck"

It only appears when a swap is genuinely possible. If it's missing:

| What you see in the booking | Why | What to do |
|---|---|---|
| No section at all, only one truck is on | There's nothing to move to | Turn the other truck on in **Trucks & lockboxes** |
| No section, booking is In use / Returned | The renter has the truck or is done | Nothing — it can't be swapped |
| No section, pickup is today | The lockbox code has already gone out | Contact the renter directly |
| Button greyed, "Truck B is out on these dates" | Other truck is booked | Move that booking first, or pick other dates |

## What the renter, Diana and the system get

- **Renter:** a text and an email saying their truck changed, with the new
  truck's name. The lockbox code is **not** in it — it still arrives on the
  day, and it's the new truck's code. If it's a same-day swap, the message says
  the code will be texted today.
- **Diana:** an alert by email and text.
- **Calendar:** the same events, relabelled "Truck B · Name" and recoloured.
- **Activity log:** "Moved from Truck A to Truck B".

## One thing to know about the signed contract

The signed agreement is a PDF that lists the truck's **licence plate and
year**. It cannot be regenerated, so after a swap it still names the truck the
booking was on when it was signed. The renter's message says so and the log
records it. Worth asking your attorney whether the contract should say "or a
comparable vehicle", so a swap never needs this caveat.

## Rehearse it first (optional, recommended for anything unusual)

Ask Claude: **"preview the swap for Salinas"**, or run:

```
npm run swap:preview -- Salinas
npm run swap:preview -- Salinas B
```

It shows exactly what the renter would be sent, what Diana would be told, what
the calendar will say, and whether the move is allowed. It **sends nothing and
changes nothing**.

## Check it worked

- In the booking, **Messages sent** shows `truck changed` (email and text) as
  sent, and **Activity** shows the move.
- Run `npm run check:invariants`. It reads the live database and the Google
  calendar and reports PASS or FAIL on six things: every booking has a truck,
  nothing overlaps, nothing upcoming is on a switched-off truck, no message
  carries the wrong lockbox code, the calendar matches the bookings, and the
  database guard is installed.

## Moving several bookings

Do them one at a time; each one texts its own renter. Nothing special is
needed, and you can't double-book a truck — the database itself refuses an
overlap.

## Undoing a swap

Swap it back the same way. The renter gets another "truck changed" message,
and so does Diana.
