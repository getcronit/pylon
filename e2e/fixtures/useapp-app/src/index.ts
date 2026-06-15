// Host: the root composes the app Pylons (one merged schema + mounted routes).
import {Pylon} from '@getcronit/pylon'
import {projects} from './apps/projects'

export default new Pylon().compose(projects)
