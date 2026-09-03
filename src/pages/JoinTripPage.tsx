import { navigate } from '../router'
import { Empty } from '../components/ui'

/** 第二階段會接上：拉旅程、解密、選自己是誰。 */
export default function JoinTripPage({ id }: { id: string; secret: string }) {
  return (
    <div className="page">
      <Empty mood="sleepy" title="共編加入建置中" hint={`旅程 ${id}`}>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/', true)}>
          回首頁
        </button>
      </Empty>
    </div>
  )
}
