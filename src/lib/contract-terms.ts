/**
 * The legal text, transcribed verbatim from the signed sample PDFs.
 *
 * TERMS_VERSION must be bumped whenever a single word changes. Every signature
 * stores the version and a hash of the exact text shown, so you can prove years
 * later what a specific person agreed to.
 *
 * NOTE FOR REVIEW: clause 13(a) of the Rental Agreement specifies Texas law,
 * while clause 12 of the Waiver bound behind it specifies California law with
 * venue in Riverside County. Both appear in the same signed packet. This is
 * carried over from the source documents as-is and should be settled with
 * counsel before the next version.
 */

export const TERMS_VERSION = '2026-09-07.1';

export type Clause = { n: string; title?: string; body: string[]; sub?: string[] };

export const RENTAL_INTRO =
  'Licensee hereby rents to the Customer named on the Signature Page of the Rental Agreement the vehicle described, subject to the terms and conditions below.';

export const RENTAL_CLAUSES: Clause[] = [
  {
    n: '1',
    title: 'Driver of Vehicle',
    body: [
      'The vehicle may be driven only by the Customer or such other validly licensed individual(s) who are properly identified on this Agreement.',
    ],
  },
  {
    n: '2',
    title: 'Prohibited Use of Vehicle',
    body: [
      'The vehicle shall NOT, under any circumstances, be used for any of the following purposes or under any of the following conditions, and any such use is WITHOUT Daily Rental Company PERMISSION:',
    ],
    sub: [
      '(a) By anyone without first obtaining Daily Rental Company’s written consent.',
      '(b) By anyone under age 21 years, unless a state/province law prohibits setting an age requirement.',
      '(c) By anyone who is not a qualified and licensed driver.',
      '(d) By anyone whose driver’s license, in any state/province, has been revoked or suspended within the previous three years, even if they now possess a valid driver’s license.',
      '(e) To carry persons or property for hire, including chauffeur-driven limousine services.',
      '(f) To propel or tow any vehicle, trailer, or other object.',
      '(g) In any race, test, or contest.',
      '(h) For any illegal purpose or commission of a crime.',
      '(i) To instruct an unlicensed person in the operation of the vehicle.',
      '(j) If the vehicle is obtained from Daily Rental Company by fraud or misrepresentation.',
      '(k) To carry persons other than in the passenger compartment of the vehicle.',
      '(l) Loading the vehicle beyond its rated capacity.',
      '(m) While under the influence of alcohol or other intoxicants, such as drugs or narcotics, or any other physical or mental impairment that adversely affects the driver’s ability to operate the vehicle.',
      '(n) Intentionally causing damage to or loss of the vehicle.',
      '(o) On any other than a paved road or graded private road or driveway.',
      '(p) In an unsafe, reckless, grossly negligent, or wanton manner. Violating a traffic law or receiving a ticket in an accident is not automatically a violation of this provision but may be an indication that a violation has occurred.',
      '(q) To carry more passengers than seatbelts.',
      '(r) Outside the state/province where the vehicle was rented unless prior written consent is obtained from the Licensee.',
      '(s) In any area where the roads are not sufficient for the vehicle’s clearance.',
      '(t) If cargo is improperly loaded or secured.',
      '(u) By the Customer for advertising purposes.',
      '(v) To transport animals of any kind or nature, living or otherwise.',
    ],
  },
  {
    n: '',
    body: [
      'PROHIBITED USE OF VEHICLE VIOLATES THIS AGREEMENT, VOIDS ALL LIABILITY AND OTHER INSURANCE COVERAGE (WHERE PERMITTED BY LAW), MAKES THE VEHICLE SUBJECT TO IMMEDIATE RECOVERY BY ON THE MOVE, INC., VOIDS DWI, AND MAKES THE RENTER RESPONSIBLE FOR ALL LOSS OF, OR DAMAGE TO, OR CONNECTED WITH THE VEHICLE, REGARDLESS OF CAUSE, INCLUDING BUT NOT LIMITED TO DAILY RENTAL COMPANY’S EXPENSES, INCLUDING LOSS OF USE.',
    ],
  },
  {
    n: '3',
    title: 'Return of Vehicle',
    body: [
      'The vehicle shall be returned to the Licensee at the time and date specified on the Rental Agreement, in the same condition as when received, ordinary wear and tear excepted. The customer will be charged for any cleaning or repair costs necessary to return the vehicle to the required condition. The determination as to the condition of the vehicle shall be made solely by the Licensee. If the customer fails to return the vehicle as specified, within three days of the time required on the Rental Agreement, such failure shall constitute an unauthorized taking of the vehicle, and the Licensee may take any steps it deems reasonable for the recovery of the vehicle. The vehicle may be repossessed if it is improperly parked, appears to be abandoned, if the vehicle is being used in violation of this Agreement, or if the Customer violates the terms of this Agreement in any other manner. The Customer agrees to indemnify and hold harmless the Licensee from any action taken by the Licensee under this Agreement. Renter must return the vehicle to our rental office at the date and time specified. The vehicle remains subject to the terms and conditions of this Agreement until we have inspected and accepted it. If the return occurs after hours, the renter is still responsible for any damage to the vehicle until it is inspected and accepted the next business day.',
    ],
  },
  {
    n: '4',
    title: 'Subletting',
    body: ['Subletting or re-letting of the vehicle is not permitted, and the vehicle shall not be used for any illegal purpose.'],
  },
  {
    n: '5',
    title: 'Fees, Licenses, Permits, Taxes, and Fines',
    body: [
      'The Customer shall be solely responsible for payment of any fees, licenses, permits, taxes, or fines, required or resulting from the Customer’s use or operation of the vehicle.',
    ],
  },
  {
    n: '6',
    title: 'Charges',
    body: [
      'The Customer shall pay all charges required under this Agreement upon demand. The Customer agrees that mileage and time charges begin on the Rental Agreement at the minimum charge only and that no refund or reimbursement is due to the Customer in the event that fewer days or miles are actually used. No pro-rations will be made by the Licensee.',
    ],
  },
  {
    n: '7',
    title: 'Insurance',
    body: [
      'The Customer agrees to maintain automobile LIABILITY/TRUCK INSURANCE during the term of this rental agreement, providing the owner, the renter, and any other person using or operating the rental vehicle with the following primary coverage:',
    ],
    sub: [
      '(a) Bodily Injury and Property Damage Liability coverage;',
      '(b) Personal Injury Protection;',
      '(c) Uninsured Motorist coverage where required;',
      '(d) Collision and Comprehensive coverage covering the rented vehicle.',
    ],
  },
  {
    n: '',
    body: [
      'Customer’s insurance will provide at least the minimum limits of coverage required by law for financial responsibility and is the primary responsibility. We are not required to provide insurance. Where permitted, the Licensee requires proof of insurance from the Customer and reserves the right to require the Customer to obtain insurance.',
    ],
  },
  {
    n: '8',
    title: 'Other Liability',
    body: [
      'The Customer assumes all risks from the improper use of the vehicle. The Customer is responsible for damage to the Customer’s property or goods in storage or transit, or for any payment lost or stored in the vehicle. The Licensee does not hold the Licensee liable for damages from downtime, lost materials, or other consequential damages resulting from the use of the vehicle.',
    ],
  },
  {
    n: '9',
    title: 'Accidents',
    body: [
      'The Customer will immediately report any accident or damage to the vehicle to the Licensee and shall deliver to the Licensee any document received by the Customer relating to any claim, suit, or proceeding connected with any accident or event involving the vehicle.',
    ],
  },
  {
    n: '10',
    title: 'Damage to Vehicle',
    body: [
      'Except as provided elsewhere in the Agreement, the Customer is responsible for the full value of loss or damage to the vehicle. This includes, but is not limited to, liability for lost rental income in the event the vehicle is unavailable for use due to accidental damages or Customer negligence.',
    ],
  },
  {
    n: '11',
    title: 'Damage Waiver',
    body: [
      'The Licensee will not charge for accidental damages to the vehicle in most cases when purchased with a Damage Waiver. However, the waiver does not cover damages caused by fire, theft, vandalism, or intentional acts. The Customer is responsible for all collision damages from insufficient clearance and the first $2,500 of other damages.',
    ],
  },
  {
    n: '12',
    title: 'Credit Charges',
    body: [
      'The Customer will pay all charges due under this Agreement upon demand. All charges are subject to a final audit by the Licensee, and if an error is found, either party shall promptly pay or credit the other as appropriate to correct the error. The Customer expressly authorizes the Licensee to process a credit card voucher, if applicable, for any and all charges due under this Agreement.',
    ],
  },
  {
    n: '13',
    title: 'Miscellaneous Provisions',
    body: [],
    sub: [
      '(a) This Agreement is to be interpreted under the laws of the State of Texas. It represents the entire agreement of the parties and supersedes any oral agreements.',
      '(b) The Customer indemnifies the Licensee against all costs and expenses (including attorney fees) incurred due to breach of this Agreement.',
      '(c) The Licensee and On The Move, Inc. shall have no liability to the Customer for any indirect or consequential damages arising out of the use of the vehicle.',
    ],
  },
  {
    n: '',
    body: [
      'The operation renting the vehicle covered by this Agreement is independently owned and operated by a Licensee of the On The Move Corporation Rental System.',
    ],
  },
];

export const WAIVER_TITLE = 'Waiver and Release of Liability';

export const WAIVER_INTRO =
  'This Waiver and Release of Liability (the "Agreement") is entered into on this date {{date}}, by and between {{client_name}} [Client’s Name], hereinafter referred to as the "Client," and 10x Lifestyle Corporation, a California Corporation, referred to as the "Company."';

export const WAIVER_CLAUSES: Clause[] = [
  {
    n: '1',
    title: 'Background',
    body: [
      'The Client is a customer of the Company and is availing themselves of the use of moving trucks owned by Moving Made Simple, LLC. The Company is coordinating the use by Client of the trucks for Client’s convenience in connection with the real estate transaction involving the Client and the Company, and the trucks are intended to facilitate the transportation of personal belongings and items. The Company would not coordinate the use of the trucks without this Agreement.',
    ],
  },
  {
    n: '2',
    title: 'Assumption of Risk and Release',
    body: [
      'By utilizing the moving trucks provided by the Company, the Client acknowledges and agrees that there are inherent risks associated with the operation of motor vehicles, including but not limited to the risks of property damage, personal injury, and accidents. The Client expressly assumes all risks and responsibilities arising from their use of the moving trucks, and hereby releases and discharges the Company, their officers, employees, agents, and representatives from any and all claims, liabilities, actions, demands, expenses, and damages arising from or related to the use of the moving trucks.',
    ],
  },
  {
    n: '3',
    title: 'Truck Condition and Maintenance',
    body: [
      'The Client acknowledges that the Company are not the owners of the moving trucks, and the trucks are owned by Moving Made Simple, a separate legal entity. The Company make no representations or warranties regarding the condition or maintenance of the trucks, except that they are provided in good working order at the time of use. The Client acknowledges that the Company have no knowledge of any defects or issues with the trucks, and the Client uses the trucks at their own risk.',
    ],
  },
  {
    n: '4',
    title: 'Responsibility for Damages and Accidents',
    body: [
      'The Client assumes full responsibility for any damage to the moving trucks, damage to third-party property, accidents, injuries, or any other losses that may occur during the use of the trucks.',
    ],
  },
  {
    n: '5',
    title: 'Indemnification',
    body: [
      'In order to induce the Company to coordinate the use of the rental truck the Client unconditionally agrees to indemnify, defend, and hold harmless the Company, and its employees, agents, successors, shareholders, officers and directors (collectively, the Indemnified Parties, and each an Indemnified Party), from and against all claims, losses, costs, expenses, damages, obligations, and liabilities of any nature whatsoever (including, without limitation, litigation costs, and attorney’s fees and disbursements) made against, or suffered or incurred by, any Indemnified Party as a result of the Client’s use of any moving truck owned by Moving Made Simple.',
    ],
  },
  {
    n: '6',
    title: 'Selection of Counsel',
    body: [
      'Without affecting any of the Client’s obligations owing to the Company under this Agreement, the Client hereby agrees that Company may elect, in its sole and absolute discretion, to retain legal counsel of its choice on behalf of Company in connection with any claims, disputes, demands or actions made or arising in connection with the subject matter of the indemnity provided for in this Agreement, and Company may, in its sole and absolute discretion, settle or compromise any such claim, dispute, demand or action on such terms and in such a manner as Company deems appropriate. Company is under no obligation to accept Client’s selection of counsel. Any counsel selected by the Client to represent the Company must be acceptable to the Company and be independent counsel free of any conflict of interest.',
    ],
  },
  {
    n: '7',
    title: 'Waiver of Defenses',
    body: [
      'Client hereby waives any defense arising by reason of any claim or defense based upon an election of remedies by the Company, which in any manner impairs, affects, reduces, releases, destroys and/or extinguishes Client’s subrogation rights, reimbursements rights, and/or any other rights of Client to proceed against any other third party or security. Client waives all presentments, demands for performance, notices of non-performance, protests, notices of protest, notices of dishonor, notices of default, notice of acceptance of this Agreement, regarding any claim to indemnity arising under this Agreement, and all other notices or formalities to which Indemnitor may be entitled to under California law.',
    ],
  },
  {
    n: '8',
    title: 'Reliance on Agreement',
    body: [
      'It is understood and agreed that Company may rely upon this Agreement in coordinating with Moving Made Simple, LLC, for the use of the trucks by Client.',
    ],
  },
  {
    n: '9',
    title: 'Binding Effect',
    body: [
      'This agreement shall be binding on Client and Client’s respective heirs, executors, legal representatives, successors (by operation of law or otherwise), and assigns and all other Indemnified Parties. The death, the incapacity, the lack of authority, the disability, and/or the dissolution of Client shall not terminate or otherwise impair Company’s rights under this Agreement.',
    ],
  },
  {
    n: '10',
    title: 'Compliance with Laws',
    body: [
      'The Client agrees to operate the moving trucks in compliance with all applicable laws, regulations, and ordinances. The Client shall obtain any necessary permits, licenses, or authorizations required for the use of the trucks.',
    ],
  },
  {
    n: '11',
    title: 'Entire Agreement',
    body: [
      'This Agreement constitutes the entire understanding between the parties with respect to the subject matter hereof and supersedes all prior agreements, representations, and understandings.',
    ],
  },
  {
    n: '12',
    title: 'Governing Law and Venue',
    body: [
      'This Agreement shall be governed by and construed in accordance with the laws of the State of California. Any legal action or proceeding arising out of or relating to this Agreement shall be exclusively venued in the state or federal courts located in the County of Riverside, California.',
    ],
  },
  {
    n: '13',
    body: [
      'Client acknowledges that Client is executing this Agreement because of the benefits directly and indirectly accruing to Client by reason of the truck rental.',
    ],
  },
];

export const WAIVER_CLOSING =
  'By signing below, the Client acknowledges that they have read and understood this Agreement, including the risks and responsibilities associated with the use of the moving trucks, and voluntarily choose to assume these risks and release the Company from liability.';

export const DAMAGE_WAIVER_NOTICE =
  'COMPREHENSIVE / COLLISION DAMAGE WAIVER Notice: The Customer is responsible for all collision damage resulting from insufficient height or width clearances and the first $2,500.00 of any other loss or damage.';

/**
 * Tolls. Separately acknowledged rather than buried in the terms, because the
 * charge arrives weeks later by post and lands on the registered owner — so
 * this is the clause most likely to be disputed, and a tick with a timestamp
 * beside it is worth more than a paragraph nobody remembers reading.
 */
export const TOLL_AGREEMENT =
  'I understand this vehicle is not enrolled in any toll or express-lane transponder programme. If I use a toll road, bridge, express lane or any other charged route during my rental, the charge is billed to Cory Home Team as the registered owner, and I agree to reimburse Cory Home Team in full for that charge plus any late fee, penalty or administrative fee that comes with it. Toll notices can take several weeks to arrive, and I remain responsible for them after the rental has ended.';

export const TOLL_CHECKBOX_LABEL =
  'I agree to pay for any tolls I incur during this rental, including any fees or penalties.';

export const READ_AND_SIGN =
  'I have read and agree to be bound by the terms and conditions of both sides of this agreement. I have read and understand the limitations of all offered and declined insurance packages.';

/** Flat text used to compute the hash stored against each signature. */
export function fullTermsText(): string {
  const parts: string[] = [TERMS_VERSION, RENTAL_INTRO];
  for (const c of [...RENTAL_CLAUSES, ...WAIVER_CLAUSES]) {
    if (c.title) parts.push(`${c.n}. ${c.title}`);
    parts.push(...c.body);
    if (c.sub) parts.push(...c.sub);
  }
  parts.push(WAIVER_INTRO, WAIVER_CLOSING, DAMAGE_WAIVER_NOTICE, TOLL_AGREEMENT, READ_AND_SIGN);
  return parts.join('\n');
}
