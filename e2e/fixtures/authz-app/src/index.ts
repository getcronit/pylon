// One service composed from two gated apps (crm + billing).
import {Pylon} from '@getcronit/pylon'
import {billing} from './apps/billing'
import {crm} from './apps/crm'

export default new Pylon().compose(crm, billing)
