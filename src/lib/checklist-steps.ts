import { config } from './config';
import type { Step } from '@/components/ChecklistFlow';

/**
 * The six screens, rebuilt from the original forms. Pickup and drop-off share
 * a structure and differ only in wording — plus the fuel gauge, which is a
 * drop-off requirement and a pickup option.
 *
 * Turning on CHECKLIST_PICKUP_FUEL_GAUGE gives you a baseline to enforce
 * "return the gas level to the way it was received"; without it that clause is
 * unenforceable. CHECKLIST_EXTERIOR_PHOTOS adds the four corner shots that
 * protect against a pre-existing dent becoming your $2,500 problem.
 */
export function buildSteps(phase: 'PICKUP' | 'DROPOFF'): Step[] {
  const isReturn = phase === 'DROPOFF';
  const steps: Step[] = [];

  steps.push({
    id: 'intro',
    kind: 'intro',
    title: `Cory Home Team\nTruck ${isReturn ? 'Return' : 'Pickup'} Checklist`,
    body: isReturn
      ? [
          "Thank you for choosing Cory Home Team's truck rental service! This guide is designed to help you complete a seamless return process.",
          "You'll find sections for taking photos of the truck's interior and exterior, documenting the fuel gauge level, and inspecting the cargo space, including confirming the lockbox instructions for returning the keys. By following this checklist, you'll ensure a smooth return and help protect yourself from any potential charges.",
        ]
      : [
          "Thank you for choosing Cory Home Team's truck rental service! This short checklist gets you on the road.",
          "You'll find the lockbox code for the keys and a section for photographing the truck before you drive off. Taking these photos protects you — anything already marked is on record before the truck is in your hands.",
        ],
  });

  steps.push({ id: 'basic', kind: 'basic', title: 'Basic Information' });

  steps.push({ id: 'lockbox', kind: 'lockbox', title: 'Lockbox Instructions' });

  const cargoUploads: Step['uploads'] = [
    {
      key: 'cargo',
      label: 'Truck Cargo Space View',
      hint: "Photo of the truck's cargo space",
      required: true,
    },
    {
      key: 'other',
      label: 'Others',
      hint: 'Other stuff or images you want to document',
      required: false,
    },
  ];

  if (config.checklist.exteriorPhotos) {
    cargoUploads.splice(1, 0, {
      key: 'exterior',
      label: 'Exterior — four corners',
      hint: 'Front left, front right, rear left, rear right',
      required: true,
    });
  }

  steps.push({
    id: 'cargo',
    kind: 'upload',
    title: 'Take a photo of the items inside the truck',
    uploads: cargoUploads,
  });

  const wantFuel = isReturn || config.checklist.pickupFuelGauge;
  if (wantFuel) {
    steps.push({
      id: 'fuel',
      kind: 'upload',
      title: 'Dashboard Fuel Gauge Documentation',
      body: [
        isReturn
          ? 'Please take a picture of the dashboard to document the fuel level as you return the truck. This will help ensure the gas level is accurately recorded. Thank you!'
          : 'Please take a picture of the dashboard so we both have a record of the fuel level you started with. Return it at this level and there is nothing to settle.',
      ],
      uploads: [
        {
          key: 'fuel',
          label: 'Fuel Gauge Image',
          hint: 'Photo of the current fuel level',
          required: true,
        },
      ],
    });
  }

  steps.push({
    id: 'submit',
    kind: 'submit',
    title: 'Almost done',
    body: isReturn
      ? [
          'Thank you for completing the Cory Home Team Truck Rental Checklist.',
          'We have gathered all the information we need. If we require any additional details, we will reach out to you via email.',
          'We appreciate your time and cooperation!',
          'Click "SUBMIT" when you\'re ready to send your checklist.',
        ]
      : [
          "That's everything we need before you drive off.",
          'Click "SUBMIT" and the truck is yours. We will text you the return checklist on your last day.',
        ],
  });

  return steps;
}

/** Which DocKind an upload slot maps to. */
export const SLOT_KINDS: Record<string, 'CARGO' | 'EXTERIOR' | 'FUEL_GAUGE' | 'OTHER'> = {
  cargo: 'CARGO',
  exterior: 'EXTERIOR',
  fuel: 'FUEL_GAUGE',
  other: 'OTHER',
};
