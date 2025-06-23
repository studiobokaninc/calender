            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileChange}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100"
                />
                <button
                  onClick={handleCsvUpload}
                  disabled={!csvFile}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  CSVアップロード
                </button>
              </div>
              <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded-md">
                <h4 className="font-medium mb-2">CSVファイル形式について</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>ファイルはUTF-8でエンコードしてください</li>
                  <li>プロジェクト情報とタスク情報の2つのセクションが必要です</li>
                  <li>各セクションは「プロジェクト情報」「タスク情報」という行で始まります</li>
                  <li>複数の依存タスクは引用符（"）で囲んでカンマ区切りで指定してください</li>
                  <li>日付はISO 8601形式（YYYY-MM-DDTHH:mm:ss+09:00）で指定してください</li>
                  <li>プロジェクトのステータス: planning, in-progress, completed, on-hold, cancelled, delayed</li>
                  <li>タスクのステータス: todo, in-progress, review, completed, delayed</li>
                  <li>詳細な仕様は<a href="/docs/データ管理のCSVファイルのアップロード.md" className="text-blue-600 hover:underline" target="_blank">こちら</a>をご覧ください</li>
                </ul>
              </div>
            </div> 