// blog app — inits the app: re-exports its models and registers its signals.
export * from './models.js'
import './signals.js' // side-effect: connect the Author audit receiver at startup
