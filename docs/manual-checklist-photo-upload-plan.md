# Manual Checklist Photo Upload Plan

## Purpose

Allow staff to attach return photos to the correct reservation when a renter cannot upload them through the drop-off checklist link and sends the files by email, SMS, or another channel.

The manual upload must preserve provenance. It must not make a staff upload look like a renter submitted the checklist.

## Staff workflow

1. Open the renter's reservation card in the CRM.
2. Open the **Return checklist** section.
3. Select **Upload photos received another way**.
4. Choose one or multiple files and categorize them as:
   - Cargo space
   - Fuel gauge
   - Exterior
   - Other
5. Choose the source: email, SMS, or other.
6. Enter the received date, staff name, and an optional note.
7. Select either:
   - **Upload only** — attach the evidence and leave the checklist open.
   - **Upload and complete checklist** — validate required evidence, complete the checklist, and advance the rental.

## Completion rules

For a return checklist, the system should require at least:

- Cargo-space photo
- Fuel-gauge photo
- Any future photo categories enabled in checklist configuration

Staff may override a missing requirement, but must provide a reason. The activity log records the override.

Completing the return checklist moves the rental to **Returned** and sends the renter's thank-you message. Uploading evidence without completing the checklist does not change the stage.

## CRM interface

Add the manual uploader inside the reservation modal under the drop-off checklist section.

Each saved file should appear in **Photos & documents** with badges such as:

- `RETURN · FUEL GAUGE · STAFF EMAIL`

The activity log should record one readable event, for example:

> Diana uploaded four return photos received by email: fuel gauge, cargo space, and two exterior photos.

## Storage behavior

- Images are converted to WebP in the browser and verified/re-encoded by the server.
- Maximum image dimension remains 1600px at WebP quality 82.
- Files remain in private Vercel Blob storage.
- Staff view them through the existing signed, expiring file URLs.
- PDFs and image formats the server cannot decode remain in their original format.
- Existing retention, quota purge, abandoned-draft cleanup, and orphan reconciliation continue to apply.

## Data model changes

Extend `Document` with:

- `source`: `RENTER`, `STAFF_EMAIL`, `STAFF_SMS`, or `STAFF_OTHER`
- `originalFilename`
- `receivedAt`
- `uploadedBy`
- `staffNote`

Extend `Checklist` with:

- `completionSource`: `RENTER` or `STAFF`
- `completedBy`
- `overrideReason`

Existing renter uploads default to `RENTER` for backward compatibility.

## API changes

Add a dedicated staff endpoint:

```text
POST /api/admin/bookings/{bookingId}/dropoff-documents
POST /api/admin/bookings/{bookingId}/dropoff-finalize
```

The endpoint will:

1. Confirm the reservation and selected checklist exist.
2. Validate phase, source, category, file type, and file size.
3. Normalize supported images to WebP.
4. Store files privately in Vercel Blob.
5. Create the document records with staff provenance.
6. Add one activity-log entry.
7. Optionally validate and complete the checklist.
8. Trigger the normal stage, renter-message, and Diana-notification behavior only when the checklist is completed.

## Delivery phases

1. Add provenance and staff-completion fields to Prisma and migrate production.
2. Add the staff upload API using the existing private Blob pipeline.
3. Add the return-photo uploader to the reservation modal.
4. Add required-evidence validation and documented override behavior.
5. Add activity-log entries, badges, and completion notifications.
6. Test upload-only, successful completion, missing-required-photo, override, private-file access, WebP conversion, and duplicate-submit cases.

## Implementation status

Applied to the custom coded drop-off checklist and CRM. The renter's existing checklist link remains unchanged; staff can now attach emailed or texted return evidence to that same reservation, preserve its source, and optionally complete the return.

## Explicit scope decision

Do not automatically ingest Diana's mailbox in the first version. Email subjects, forwarded threads, and similar renter names can attach sensitive photos to the wrong reservation. Staff should open the correct reservation card and upload the files there. Automatic ingestion can be considered later if emails carry a reliable booking reference.
