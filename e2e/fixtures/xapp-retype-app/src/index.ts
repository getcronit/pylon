import {Pylon} from '@getcronit/pylon'
import {core} from './apps/core/index.js'
import {products} from './apps/products/index.js'

export default new Pylon().compose(core, products)
