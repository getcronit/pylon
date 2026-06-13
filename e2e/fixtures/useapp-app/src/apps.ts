import {compose} from '@getcronit/pylon-app'
import {projectsApp} from './apps/projects'

// One composed service (room for more apps — they'd just be added here).
export const composed = compose(projectsApp)
