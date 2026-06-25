// One-to-one, navigable from BOTH sides: Account owns the unique FK (belongsTo →
// single `user`); User navigates the inverse via hasOne (→ single `account`).
import {Pylon} from '@getcronit/pylon'
import {db, models, type Relation} from '@getcronit/pylon-db'

export class User extends models.Model {
  static objects = db.manager(User)
  id = models.ID()
  name = models.Text()
  account = models.HasOne(() => Account, {foreignKey: 'userId'})   // inverse → Account (nullable)
}

export class Account extends models.Model {
  static objects = db.manager(Account)
  id = models.ID()
  balance = models.Int({default: 0})
  userId = models.ForeignKey(() => User, {unique: true})           // owning, unique ⇒ 1:1
  declare user: Relation<User>                                      // owning → User
}

export default new Pylon({
  db: {models: [User, Account]},
  graphql: {
    Query: {
      users: (): Promise<User[]> => User.objects.all(),
      // filter a User by its hasOne relation (to-one nested WhereInput)
      richUsers: (): Promise<User[]> => User.objects.filter({account: {balance: {gt: 100}}}).all()
    },
    Mutation: {
      addUser: (name: string): Promise<User> => User.objects.create({name}),
      openAccount: (userId: number, balance: number): Promise<Account> =>
        Account.objects.create({userId, balance})
    }
  }
})
