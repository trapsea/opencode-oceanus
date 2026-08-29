SELECT CASE
                 WHEN grid_connect_time IS NOT NULL AND grid_connect_time <= ? AND
                      (risk_upload_time IS NULL OR risk_upload_time > ?) THEN 5
                 WHEN initial_receive_time IS NOT NULL AND initial_ship_time IS NOT NULL AND
                      report_install_time IS NOT NULL AND report_install_time <= ? AND
                      (grid_connect_time IS NULL OR grid_connect_time > ?) THEN 4
                 WHEN initial_receive_time IS NOT NULL AND initial_ship_time IS NOT NULL AND initial_ship_time <= ? AND
                      (report_install_time IS NULL OR report_install_time > ?) THEN 3
                 WHEN audit_pass_time IS NOT NULL AND audit_pass_time <= ? AND
                      (initial_receive_time IS NULL OR initial_receive_time > ?) THEN 2
                 WHEN entry_time IS NOT NULL AND entry_time <= ? AND (audit_pass_time IS NULL OR audit_pass_time > ?)
                     THEN 1
                 ELSE 0 END    AS node,
             CASE
                 WHEN grid_connect_time IS NOT NULL AND grid_connect_time <= ? AND
                      (risk_upload_time IS NULL OR risk_upload_time > ?) THEN DATEDIFF(?, grid_connect_time)
                 WHEN initial_receive_time IS NOT NULL AND initial_ship_time IS NOT NULL AND
                      report_install_time IS NOT NULL AND report_install_time <= ? AND
                      (grid_connect_time IS NULL OR grid_connect_time > ?) THEN DATEDIFF(?, initial_ship_time)
                 WHEN initial_receive_time IS NOT NULL AND initial_ship_time IS NOT NULL AND initial_ship_time <= ? AND
                      (report_install_time IS NULL OR report_install_time > ?) THEN DATEDIFF(?, initial_ship_time)
                 WHEN audit_pass_time IS NOT NULL AND audit_pass_time <= ? AND
                      (initial_receive_time IS NULL OR initial_receive_time > ?) THEN DATEDIFF(?, audit_pass_time)
                 WHEN entry_time IS NOT NULL AND entry_time <= ? AND (audit_pass_time IS NULL OR audit_pass_time > ?)
                     THEN DATEDIFF(?, entry_time)
                 ELSE NULL END AS retention
      FROM ht_orders_8 ht_orders
      WHERE deleted = 0
        AND process_status != 'CANCELLED'
        AND tenant_id = ?
        AND ( ht_orders.distributor_code IN ( ? ) OR ht_orders.id IN
        ( SELECT b.order_id FROM ht_order_type_distributor_binding_8 b WHERE b.deleted = 0 AND b.status = 'bound' AND b.tenant_id = ? AND b.distributor_code IN ( ? ) ) )
        AND ( (province_code, city_code, district_code) IN ( (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) , (?, ?, ?) )
        OR province_code IS NULL OR province_code = '' )
        AND ( risk_upload_time IS NULL OR risk_upload_time > ? OR entry_time IS NULL OR entry_time > risk_upload_time OR audit_pass_time IS NULL OR audit_pass_time > risk_upload_time OR initial_receive_time IS NULL OR initial_receive_time > risk_upload_time OR initial_ship_time IS NULL OR initial_ship_time > risk_upload_time OR report_install_time IS NULL OR report_install_time > risk_upload_time OR grid_connect_time IS NULL OR grid_connect_time > risk_upload_time )) t
